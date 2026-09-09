import { db, nowIso } from "./db.js";
import { randomUUID } from "node:crypto";
import { createOpaqueToken, isAllowedSchoolEmail } from "./lib/security.js";
import { config } from "./config.js";

export const roleLabel = (role) => ({ owner: "擁有者", editor: "可編輯", viewer: "可檢視" })[role] || "無權限";
const rank = { none: 0, viewer: 1, editor: 2, owner: 3 };
const best = (a, b) => rank[a] >= rank[b] ? a : b;

export function getResource(id) {
  return db.prepare(`SELECT r.*,u.display_name AS owner_name,u.email AS owner_email
    FROM resources r JOIN users u ON u.id=r.owner_id WHERE r.id=?`).get(id);
}

export function grantsFor(id) {
  return db.prepare(`SELECT rm.user_id,rm.role,u.email,u.display_name,u.status
    FROM resource_members rm JOIN users u ON u.id=rm.user_id WHERE rm.resource_id=? ORDER BY u.email`).all(id);
}

// Build a request-local index; no grants survive revocation or account disablement.
export function accessContext(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id=? AND status='active'").get(userId);
  const valid = user && isAllowedSchoolEmail(user.email, config.allowedEmailDomain);
  const rows = valid ? db.prepare(`SELECT r.*,u.display_name AS owner_name,u.email AS owner_email,
      EXISTS(SELECT 1 FROM resource_members rm WHERE rm.resource_id=r.id) AS has_shares
      FROM resources r JOIN users u ON u.id=r.owner_id ORDER BY r.created_at DESC,r.id`).all() : [];
  const byId = new Map(rows.map(r => [r.id,r]));
  const direct = new Map(valid ? db.prepare("SELECT resource_id,role FROM resource_members WHERE user_id=?").all(userId).map(r => [r.resource_id,r.role]) : []);
  const visits = new Map(valid ? db.prepare("SELECT resource_id,token FROM link_visits WHERE user_id=?").all(userId).map(r => [r.resource_id,r.token]) : []);
  const memo = new Map();
  const trashMemo = new Map();
  function isTrashed(id,seen = new Set()) {
    if (trashMemo.has(id)) return trashMemo.get(id);
    const row = byId.get(id);
    if (!row || seen.has(id)) return true;
    seen.add(id);
    const result = Boolean(row.trashed_at) || Boolean(row.parent_id && isTrashed(row.parent_id,seen));
    trashMemo.set(id,result);
    return result;
  }
  function permission(id, seen = new Set()) {
    if (memo.has(id)) return memo.get(id);
    const row = byId.get(id);
    if (!row || seen.has(id) || isTrashed(id)) return "none";
    seen.add(id);
    let role = row.owner_id === userId ? "owner" : "none";
    if (row.access_level === "members") role = best(role,"viewer"); // Preserve legacy grants only.
    role = best(role,direct.get(id) || "none");
    if (row.link_token && visits.get(id) === row.link_token) role = best(role,row.link_role);
    if (row.parent_id) {
      const inherited = permission(row.parent_id,seen);
      role = best(role,inherited === "owner" ? "editor" : inherited);
    }
    memo.set(id,role);
    return role;
  }
  return { rows, byId, permission, isTrashed };
}

export function permissionFor(id,userId) { return accessContext(userId).permission(id); }
export function canEdit(id,userId) { return ["owner","editor"].includes(permissionFor(id,userId)); }

export function createItem({ id,kind,title,description="",url=null,storageKey=null,originalName=null,mimeType=null,sizeBytes=null,ownerId,parentId=null }) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO resources (id,kind,title,description,url,storage_key,original_name,mime_type,size_bytes,owner_id,parent_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,kind,title,description,url,storageKey,originalName,mimeType,sizeBytes,ownerId,parentId,now,now);
    insertVersion(getResource(id),ownerId,"created",now);
    db.exec("COMMIT");
    return getResource(id);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function insertVersion(row,actorId,event,createdAt = nowIso()) {
  db.prepare(`INSERT INTO resource_versions (
    id,resource_id,revision,title,description,url,storage_key,original_name,mime_type,size_bytes,parent_id,event,created_by,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(),row.id,row.revision,row.title,row.description,row.url,row.storage_key,row.original_name,row.mime_type,
    row.size_bytes,row.parent_id,event,actorId,createdAt,
  );
}

export function saveItem(id,revision,{ title,description,url,storageKey,originalName,mimeType,sizeBytes },actorId) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(`UPDATE resources SET title=?,description=?,url=?,
      storage_key=COALESCE(?,storage_key),original_name=COALESCE(?,original_name),
      mime_type=COALESCE(?,mime_type),size_bytes=COALESCE(?,size_bytes),updated_at=?,revision=revision+1
      WHERE id=? AND revision=? AND trashed_at IS NULL`).run(title,description,url || null,storageKey || null,originalName || null,mimeType || null,sizeBytes ?? null,nowIso(),id,revision);
    if (result.changes !== 1) { db.exec("ROLLBACK"); return false; }
    insertVersion(getResource(id),actorId,"edited");
    db.exec("COMMIT");
    return true;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listVersions(id) {
  return db.prepare(`SELECT rv.*,u.display_name AS actor_name
    FROM resource_versions rv LEFT JOIN users u ON u.id=rv.created_by
    WHERE rv.resource_id=? ORDER BY rv.revision DESC`).all(id);
}

export function getVersion(id,revision) {
  return db.prepare("SELECT * FROM resource_versions WHERE resource_id=? AND revision=?")
    .get(id,revision);
}

export function restoreVersion(id,revision,actorId) {
  const current = getResource(id);
  const version = getVersion(id,revision);
  if (!current || current.trashed_at || !version) return null;
  let parentId = version.parent_id;
  if (parentId && !canEdit(parentId,actorId)) parentId = current.parent_id;
  let cursor = parentId ? getResource(parentId) : null;
  const seen = new Set();
  while (cursor) {
    if (cursor.id === id || cursor.trashed_at || seen.has(cursor.id)) { parentId = current.parent_id; break; }
    seen.add(cursor.id);
    cursor = cursor.parent_id ? getResource(cursor.parent_id) : null;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const updatedAt = nowIso();
    db.prepare(`UPDATE resources SET title=?,description=?,url=?,storage_key=?,original_name=?,mime_type=?,
      size_bytes=?,parent_id=?,updated_at=?,revision=revision+1 WHERE id=?`).run(
      version.title,version.description,version.url,version.storage_key,version.original_name,version.mime_type,
      version.size_bytes,parentId,updatedAt,id,
    );
    const restored = getResource(id);
    insertVersion(restored,actorId,"restored",updatedAt);
    db.exec("COMMIT");
    return restored;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function moveItem(id,parentId,ownerId) {
  const item = getResource(id);
  if (!item || item.owner_id !== ownerId || item.trashed_at) return false;
  let cursor = parentId ? getResource(parentId) : null;
  if (parentId && (!cursor || cursor.kind !== "folder" || cursor.trashed_at)) return false;
  const seen = new Set();
  while (cursor) {
    if (cursor.id === id || seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    cursor = cursor.parent_id ? getResource(cursor.parent_id) : null;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const updatedAt = nowIso();
    const result = db.prepare("UPDATE resources SET parent_id=?,updated_at=?,revision=revision+1 WHERE id=? AND owner_id=? AND trashed_at IS NULL")
      .run(parentId || null,updatedAt,id,ownerId);
    if (result.changes !== 1) { db.exec("ROLLBACK"); return false; }
    insertVersion(getResource(id),ownerId,"moved",updatedAt);
    db.exec("COMMIT");
    return true;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function trashItem(id,ownerId) {
  const item = getResource(id);
  if (!item || item.owner_id !== ownerId || item.trashed_at) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (item.kind === "folder") {
      const foreignRoots = db.prepare(`WITH RECURSIVE tree(id) AS (
        SELECT id FROM resources WHERE id=?
        UNION ALL SELECT r.id FROM resources r JOIN tree t ON r.parent_id=t.id
      )
      SELECT r.* FROM resources r JOIN tree t ON t.id=r.id
      JOIN resources parent ON parent.id=r.parent_id
      WHERE r.id!=? AND r.owner_id!=? AND parent.owner_id=?`).all(id,id,ownerId,ownerId);
      for (const row of foreignRoots) {
        const updatedAt = nowIso();
        db.prepare("UPDATE resources SET parent_id=NULL,updated_at=?,revision=revision+1 WHERE id=?").run(updatedAt,row.id);
        insertVersion(getResource(row.id),ownerId,"moved",updatedAt);
      }
    }
    const updatedAt = nowIso();
    const result = db.prepare("UPDATE resources SET trashed_at=?,updated_at=? WHERE id=? AND owner_id=? AND trashed_at IS NULL")
      .run(updatedAt,updatedAt,id,ownerId);
    db.exec("COMMIT");
    return result.changes === 1;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function restoreTrashedItem(id,ownerId) {
  return db.prepare("UPDATE resources SET trashed_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND trashed_at IS NOT NULL")
    .run(nowIso(),id,ownerId).changes === 1;
}

export function listTrashedOwned(ownerId) {
  return db.prepare(`SELECT r.*,u.display_name AS owner_name,u.email AS owner_email
    FROM resources r JOIN users u ON u.id=r.owner_id
    WHERE r.owner_id=? AND r.trashed_at IS NOT NULL ORDER BY r.trashed_at DESC`).all(ownerId);
}

export function permanentlyDeleteItem(id,ownerId) {
  const item = getResource(id);
  if (!item || item.owner_id !== ownerId || !item.trashed_at) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`WITH RECURSIVE tree(id,depth) AS (
      SELECT id,0 FROM resources WHERE id=?
      UNION ALL SELECT r.id,tree.depth+1 FROM resources r JOIN tree ON r.parent_id=tree.id
    ) SELECT r.*,tree.depth FROM resources r JOIN tree ON tree.id=r.id ORDER BY tree.depth DESC`).all(id);
    if (rows.some(row => row.owner_id !== ownerId)) { db.exec("ROLLBACK"); return null; }
    const resourceIds = rows.map(row => row.id);
    const keys = new Set(rows.map(row => row.storage_key).filter(Boolean));
    for (const resourceId of resourceIds) {
      for (const version of db.prepare("SELECT storage_key FROM resource_versions WHERE resource_id=? AND storage_key IS NOT NULL").all(resourceId)) keys.add(version.storage_key);
    }
    const remove = db.prepare("DELETE FROM resources WHERE id=? AND owner_id=?");
    for (const row of rows) remove.run(row.id,ownerId);
    const stillUsed = db.prepare(`SELECT 1 FROM resources WHERE storage_key=?
      UNION ALL SELECT 1 FROM resource_versions WHERE storage_key=? LIMIT 1`);
    const unusedKeys = [...keys].filter(key => !stillUsed.get(key,key));
    db.exec("COMMIT");
    return unusedKeys;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function setEmailGrant(id,userId,role) {
  db.prepare(`INSERT INTO resource_members(resource_id,user_id,role) VALUES (?,?,?)
    ON CONFLICT(resource_id,user_id) DO UPDATE SET role=excluded.role`).run(id,userId,role);
}
export function removeEmailGrant(id,userId) {
  db.prepare("DELETE FROM resource_members WHERE resource_id=? AND user_id=?").run(id,userId);
}
export function setLink(id,role,rotate=false) {
  const current = getResource(id);
  const token = role === "off" ? null : (!rotate && current.link_token) || createOpaqueToken();
  db.prepare("UPDATE resources SET link_token=?,link_role=? WHERE id=?").run(token,role === "off" ? "viewer" : role,id);
  return token;
}
export function followLink(token,userId) {
  const row = db.prepare("SELECT id FROM resources WHERE link_token=?").get(token);
  if (!row) return null;
  db.prepare(`INSERT INTO link_visits(resource_id,user_id,token) VALUES (?,?,?)
    ON CONFLICT(resource_id,user_id) DO UPDATE SET token=excluded.token`).run(row.id,userId,token);
  return row.id;
}
export function makePrivate(id) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM resource_members WHERE resource_id=?").run(id);
    db.prepare("UPDATE resources SET link_token=NULL,access_level='private' WHERE id=?").run(id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
