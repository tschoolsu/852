import path from "node:path";

// Append migrations. Preserve existing account, file and sharing data.
export function migrateResources(db, dataDir) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 1").get()) {
   if (db.prepare("SELECT COUNT(*) AS n FROM resources").get().n > 0) {
    db.prepare("VACUUM INTO ?").run(path.join(dataDir, `before-sharing-v1-${Date.now()}.sqlite`));
   }
   db.exec("PRAGMA foreign_keys = OFF");
   db.exec("BEGIN IMMEDIATE");
   try {
    db.exec(`
      CREATE TABLE resources_next (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('file','link','folder')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        url TEXT,
        storage_key TEXT,
        original_name TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        access_level TEXT NOT NULL DEFAULT 'private' CHECK (access_level IN ('private','selected','members')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        parent_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
        link_token TEXT UNIQUE,
        link_role TEXT NOT NULL DEFAULT 'viewer' CHECK (link_role IN ('viewer','editor')),
        revision INTEGER NOT NULL DEFAULT 1,
        CHECK (parent_id IS NULL OR parent_id != id),
        CHECK ((kind='file' AND storage_key IS NOT NULL AND original_name IS NOT NULL)
          OR (kind='link' AND url IS NOT NULL) OR kind='folder')
      );
      INSERT INTO resources_next (id,kind,title,description,url,storage_key,original_name,mime_type,size_bytes,owner_id,access_level,created_at,updated_at)
        SELECT id,kind,title,description,url,storage_key,original_name,mime_type,size_bytes,owner_id,access_level,created_at,updated_at FROM resources;
      DROP TABLE resources;
      ALTER TABLE resources_next RENAME TO resources;
      ALTER TABLE resource_members ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','editor'));
      CREATE TABLE link_visits (
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        PRIMARY KEY (resource_id,user_id)
      );
      CREATE INDEX idx_resources_parent ON resources(parent_id);
      CREATE INDEX idx_resources_owner_id ON resources(owner_id,created_at DESC);
      CREATE INDEX idx_resources_access_created ON resources(access_level,created_at DESC);
      CREATE INDEX idx_link_visits_user ON link_visits(user_id);
    `);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Migration foreign key validation failed");
    db.prepare("INSERT INTO schema_migrations VALUES (1,?)").run(new Date().toISOString());
    db.exec("COMMIT");
   } catch (error) {
    db.exec("ROLLBACK");
    throw error;
   } finally {
    db.exec("PRAGMA foreign_keys = ON");
   }
  }

  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 2").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        ALTER TABLE users ADD COLUMN google_subject TEXT;
        CREATE UNIQUE INDEX idx_users_google_subject ON users(google_subject) WHERE google_subject IS NOT NULL;
        CREATE TABLE oauth_registration_states (
          state_hash TEXT PRIMARY KEY,
          code_verifier TEXT NOT NULL,
          nonce TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE verified_registrations (
          token_hash TEXT PRIMARY KEY,
          email TEXT NOT NULL COLLATE NOCASE,
          display_name TEXT NOT NULL,
          google_subject TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_oauth_registration_states_expires ON oauth_registration_states(expires_at);
        CREATE INDEX idx_verified_registrations_expires ON verified_registrations(expires_at);
      `);
      db.prepare("INSERT INTO schema_migrations VALUES (2,?)").run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
