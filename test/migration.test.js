import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateResources } from "../src/migrations.js";

test("升級保留既有檔案、Email 分享、公開成員設定且可重複啟動",async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"tfiles-migration-"));
  const db = new DatabaseSync(path.join(dir,"test.sqlite"));
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE resources(id TEXT PRIMARY KEY,kind TEXT CHECK(kind IN ('file','link')),title TEXT,description TEXT,url TEXT,storage_key TEXT,original_name TEXT,mime_type TEXT,size_bytes INTEGER,owner_id TEXT REFERENCES users(id),access_level TEXT,created_at TEXT,updated_at TEXT);
      CREATE TABLE resource_members(resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),PRIMARY KEY(resource_id,user_id));
      INSERT INTO users VALUES ('owner'),('viewer');
      INSERT INTO resources VALUES ('file','file','既有檔案','','', 'old-key','原始檔案.txt','text/plain',12,'owner','selected','2026-01-01','2026-01-01');
      INSERT INTO resources VALUES ('link','link','既有連結','','https://example.com',NULL,NULL,NULL,NULL,'owner','members','2026-01-01','2026-01-01');
      INSERT INTO resource_members VALUES ('file','viewer');
    `);
    migrateResources(db,dir);
    migrateResources(db,dir);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM resources").get().n,2);
    assert.equal(db.prepare("SELECT storage_key FROM resources WHERE id='file'").get().storage_key,"old-key");
    assert.equal(db.prepare("SELECT role FROM resource_members").get().role,"viewer");
    assert.equal(db.prepare("SELECT access_level FROM resources WHERE id='link'").get().access_level,"members");
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys,1);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
    assert.deepEqual(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(row=>row.version),[1,2]);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='verified_registrations'").get());
    assert.equal((await fs.readdir(dir)).filter(x=>x.startsWith("before-sharing-v1-")).length,1);
  } finally {
    db.close();
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error("Unexpected directory");
    await fs.rm(dir,{recursive:true,force:true});
  }
});
