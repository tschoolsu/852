import { db, nowIso } from "./db.js";
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
  function permission(id, seen = new Set()) {
    if (memo.has(id)) return memo.get(id);
    const row = byId.get(id);
    if (!row || seen.has(id)) return "none";
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
  return { rows, byId, permission };
}

export function permissionFor(id,userId) { return accessContext(userId).permission(id); }
export function canEdit(id,userId) { return ["owner","editor"].includes(permissionFor(id,userId)); }

export function createItem({ id,kind,title,description="",url=null,storageKey=null,originalName=null,mimeType=null,sizeBytes=null,ownerId,parentId=null }) {
  const now = nowIso();
  db.prepare(`INSERT INTO resources (id,kind,title,description,url,storage_key,original_name,mime_type,size_bytes,owner_id,parent_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,kind,title,description,url,storageKey,originalName,mimeType,sizeBytes,ownerId,parentId,now,now);
  return getResource(id);
}

export function saveItem(id,revision,{ title,description,url,storageKey,originalName,mimeType,sizeBytes }) {
  const result = db.prepare(`UPDATE resources SET title=?,description=?,url=?,
    storage_key=COALESCE(?,storage_key),original_name=COALESCE(?,original_name),
    mime_type=COALESCE(?,mime_type),size_bytes=COALESCE(?,size_bytes),updated_at=?,revision=revision+1
    WHERE id=? AND revision=?`).run(title,description,url || null,storageKey || null,originalName || null,mimeType || null,sizeBytes ?? null,nowIso(),id,revision);
  return result.changes === 1;
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
