import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(path.join(config.dataDir, "tfiles.sqlite"));
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    url TEXT,
    storage_key TEXT,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    access_level TEXT NOT NULL DEFAULT 'private' CHECK (access_level IN ('private', 'selected', 'members')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (kind = 'file' AND storage_key IS NOT NULL AND original_name IS NOT NULL)
      OR (kind = 'link' AND url IS NOT NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS resource_members (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (resource_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
  CREATE INDEX IF NOT EXISTS idx_resources_owner_id ON resources(owner_id);
  CREATE INDEX IF NOT EXISTS idx_resources_access_created ON resources(access_level, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_resource_members_user_id ON resource_members(user_id, resource_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
`);

db.exec("PRAGMA optimize;");

export function nowIso() {
  return new Date().toISOString();
}

export function syncConfiguredAdmins() {
  const update = db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE email = ? COLLATE NOCASE");
  const now = nowIso();
  for (const email of config.adminEmails) update.run(now, email);
}

export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email);
}

export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function listActiveUsers(excludeUserId = "") {
  return db
    .prepare("SELECT id, email, display_name FROM users WHERE status = 'active' AND id != ? ORDER BY display_name COLLATE NOCASE")
    .all(excludeUserId);
}

export function createUser({ id, email, displayName, passwordHash, role, status }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, email, displayName, passwordHash, role, status, now, now);
  return getUserById(id);
}

export function createSession({ tokenHash, userId, csrfToken, expiresAt }) {
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(tokenHash, userId, csrfToken, expiresAt, nowIso());
}

export function getSession(tokenHash) {
  return db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.csrf_token, s.expires_at,
              u.email, u.display_name, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash, nowIso());
}

export function deleteSession(tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function pruneExpiredRecords() {
  const now = nowIso();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM password_resets WHERE expires_at <= ? OR used_at IS NOT NULL").run(now);
}

export function createPasswordReset({ tokenHash, userId, expiresAt }) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId);
    db.prepare(
      "INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).run(tokenHash, userId, expiresAt, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getValidPasswordReset(tokenHash) {
  return db
    .prepare(
      `SELECT pr.*, u.email, u.status
       FROM password_resets pr JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > ?`,
    )
    .get(tokenHash, nowIso());
}

export function consumePasswordReset(tokenHash, passwordHash) {
  const reset = getValidPasswordReset(tokenHash);
  if (!reset) return false;
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now, reset.user_id);
    db.prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").run(now, tokenHash);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(reset.user_id);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createResource(resource, memberIds = []) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO resources
       (id, kind, title, description, url, storage_key, original_name, mime_type, size_bytes, owner_id, access_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      resource.id,
      resource.kind,
      resource.title,
      resource.description || "",
      resource.url || null,
      resource.storageKey || null,
      resource.originalName || null,
      resource.mimeType || null,
      resource.sizeBytes ?? null,
      resource.ownerId,
      resource.accessLevel,
      now,
      now,
    );
    const addMember = db.prepare("INSERT OR IGNORE INTO resource_members (resource_id, user_id) VALUES (?, ?)");
    for (const memberId of memberIds) addMember.run(resource.id, memberId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getResourceById(resource.id);
}

export function getResourceById(id) {
  return db
    .prepare(
      `SELECT r.*, u.display_name AS owner_name, u.email AS owner_email
       FROM resources r JOIN users u ON u.id = r.owner_id WHERE r.id = ?`,
    )
    .get(id);
}

export function getResourceMemberIds(resourceId) {
  return db.prepare("SELECT user_id FROM resource_members WHERE resource_id = ?").all(resourceId).map((row) => row.user_id);
}

export function userCanAccessResource(resourceId, userId) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM resources r
         WHERE r.id = ? AND (
           r.owner_id = ? OR r.access_level = 'members' OR
           (r.access_level = 'selected' AND EXISTS (
             SELECT 1 FROM resource_members rm WHERE rm.resource_id = r.id AND rm.user_id = ?
           ))
         )`,
      )
      .get(resourceId, userId, userId),
  );
}

export function listAccessibleResources(userId, search = "") {
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .prepare(
      `SELECT r.*, u.display_name AS owner_name
       FROM resources r JOIN users u ON u.id = r.owner_id
       WHERE (r.owner_id = ? OR r.access_level = 'members' OR EXISTS (
         SELECT 1 FROM resource_members rm WHERE rm.resource_id = r.id AND rm.user_id = ?
       ))
       AND (? = '' OR r.title LIKE ? ESCAPE '\\' OR r.original_name LIKE ? ESCAPE '\\')
       ORDER BY r.created_at DESC`,
    )
    .all(userId, userId, search, pattern, pattern);
}

export function updateResourceAccess(resourceId, ownerId, accessLevel, memberIds = []) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db
      .prepare("UPDATE resources SET access_level = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(accessLevel, now, resourceId, ownerId);
    if (result.changes !== 1) throw new Error("RESOURCE_NOT_FOUND");
    db.prepare("DELETE FROM resource_members WHERE resource_id = ?").run(resourceId);
    if (accessLevel === "selected") {
      const addMember = db.prepare("INSERT OR IGNORE INTO resource_members (resource_id, user_id) VALUES (?, ?)");
      for (const memberId of memberIds) addMember.run(resourceId, memberId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listPendingUsers() {
  return db
    .prepare("SELECT id, email, display_name, created_at FROM users WHERE status = 'pending' ORDER BY created_at")
    .all();
}

export function approveUser(userId) {
  return db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending'").run(nowIso(), userId);
}

export function audit(actorId, action, targetType = null, targetId = null, details = {}) {
  db.prepare(
    "INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(actorId || null, action, targetType, targetId, JSON.stringify(details), nowIso());
}

syncConfiguredAdmins();
pruneExpiredRecords();
