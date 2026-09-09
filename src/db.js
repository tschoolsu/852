import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { migrateResources } from "./migrations.js";

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

migrateResources(db, config.dataDir);
db.exec("PRAGMA optimize;");

export function nowIso() {
  return new Date().toISOString();
}

export function syncConfiguredAdmins() {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET role = 'member', updated_at = ? WHERE role = 'admin'").run(now);
    const update = db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE email = ? COLLATE NOCASE");
    for (const email of config.adminEmails) update.run(now, email);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

export function searchActiveUsers(query, excludeUserId = "", limit = 8) {
  const text = String(query || "").trim().slice(0, 100);
  if (text.length < 2) return [];
  const escaped = text.replace(/[\\%_]/g, "\\$&");
  return db.prepare(`SELECT id, email, display_name
    FROM users
    WHERE status = 'active' AND id != ?
      AND (email LIKE ? ESCAPE '\\' COLLATE NOCASE OR display_name LIKE ? ESCAPE '\\' COLLATE NOCASE)
    ORDER BY CASE WHEN email = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE THEN 0 ELSE 1 END,
      display_name COLLATE NOCASE, email COLLATE NOCASE
    LIMIT ?`).all(excludeUserId, `%${escaped}%`, `%${escaped}%`, text, text, Math.min(Math.max(Number(limit) || 8, 1), 20));
}

export function getActiveUserByEmailOrName(value) {
  const text = String(value || "").trim().slice(0, 100);
  if (!text) return { user: null, ambiguous: false };
  const byEmail = db.prepare("SELECT * FROM users WHERE status = 'active' AND email = ? COLLATE NOCASE").get(text);
  if (byEmail) return { user: byEmail, ambiguous: false };
  const byName = db.prepare("SELECT * FROM users WHERE status = 'active' AND display_name = ? COLLATE NOCASE ORDER BY email LIMIT 2").all(text);
  return { user: byName.length === 1 ? byName[0] : null, ambiguous: byName.length > 1 };
}

export function createUser({ id, email, displayName, passwordHash, role, status, googleSubject = null }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at, google_subject)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, email, displayName, passwordHash, role, status, now, now, googleSubject);
  return getUserById(id);
}

export function createOAuthRegistrationState({ stateHash, codeVerifier, nonce, expiresAt, nextPath = "/app" }) {
  pruneExpiredRecords();
  db.prepare(`INSERT INTO oauth_registration_states(state_hash,code_verifier,nonce,expires_at,created_at,next_path)
    VALUES (?,?,?,?,?,?)`).run(stateHash,codeVerifier,nonce,expiresAt,nowIso(),nextPath);
}

export function consumeOAuthRegistrationState(stateHash) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM oauth_registration_states WHERE state_hash=? AND expires_at>?").get(stateHash,nowIso());
    db.prepare("DELETE FROM oauth_registration_states WHERE state_hash=?").run(stateHash);
    db.exec("COMMIT");
    return row || null;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createVerifiedRegistration({ tokenHash,email,displayName,googleSubject,expiresAt }) {
  db.prepare(`INSERT INTO verified_registrations(token_hash,email,display_name,google_subject,expires_at,created_at)
    VALUES (?,?,?,?,?,?)`).run(tokenHash,email,displayName,googleSubject,expiresAt,nowIso());
}

export function getVerifiedRegistration(tokenHash) {
  return db.prepare("SELECT * FROM verified_registrations WHERE token_hash=? AND expires_at>?").get(tokenHash,nowIso());
}

export function createUserFromVerifiedRegistration({ tokenHash,id,passwordHash,role,status }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const verified = db.prepare("SELECT * FROM verified_registrations WHERE token_hash=? AND expires_at>?").get(tokenHash,nowIso());
    if (!verified) {
      db.exec("ROLLBACK");
      return { outcome:"invalid",user:null };
    }
    const existing = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE OR google_subject=?").get(verified.email,verified.google_subject);
    db.prepare("DELETE FROM verified_registrations WHERE token_hash=?").run(tokenHash);
    if (existing) {
      db.exec("COMMIT");
      return { outcome:"exists",user:existing };
    }
    const now = nowIso();
    db.prepare(`INSERT INTO users(id,email,display_name,password_hash,role,status,created_at,updated_at,google_subject)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id,verified.email,verified.display_name,passwordHash,role,status,now,now,verified.google_subject);
    db.exec("COMMIT");
    return { outcome:"created",user:getUserById(id) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function signInWithGoogle({ id,email,displayName,googleSubject,passwordHash,status }) {
  const now = nowIso();
  const role = config.adminEmails.has(email) ? "admin" : "member";
  db.exec("BEGIN IMMEDIATE");
  try {
    const bySubject = db.prepare("SELECT * FROM users WHERE google_subject=?").get(googleSubject);
    const byEmail = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(email);
    if (bySubject && byEmail && bySubject.id !== byEmail.id) {
      db.exec("ROLLBACK");
      return { outcome:"conflict",user:null };
    }
    const user = bySubject || byEmail;
    if (user?.google_subject && user.google_subject !== googleSubject) {
      db.exec("ROLLBACK");
      return { outcome:"conflict",user:null };
    }
    if (user) {
      db.prepare(`UPDATE users SET email=?,display_name=?,google_subject=?,role=?,updated_at=? WHERE id=?`)
        .run(email,displayName,googleSubject,role,now,user.id);
      db.exec("COMMIT");
      return { outcome:"existing",user:getUserById(user.id) };
    }
    db.prepare(`INSERT INTO users(id,email,display_name,password_hash,role,status,created_at,updated_at,google_subject)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id,email,displayName,passwordHash,role,status,now,now,googleSubject);
    db.exec("COMMIT");
    return { outcome:"created",user:getUserById(id) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
  db.prepare("DELETE FROM oauth_registration_states WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM verified_registrations WHERE expires_at <= ?").run(now);
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
