import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

test("Google 第一次登入建立帳號，之後同步本名並以設定維護管理員",async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),"tfiles-google-user-"));
  Object.assign(process.env,{ NODE_ENV:"test",DATA_DIR:dataDir,SESSION_SECRET:"google-user-test-secret-with-more-than-32-characters",
    ADMIN_EMAILS:"boss@tschool.tp.edu.tw",ALLOWED_EMAIL_DOMAIN:"tschool.tp.edu.tw" });
  const { db,createUser,signInWithGoogle,syncConfiguredAdmins } = await import("../src/db.js");
  try {
    const passwordHash = "unused-google-only-password-hash";
    createUser({ id:randomUUID(),email:"boss@tschool.tp.edu.tw",displayName:"舊名稱",passwordHash,role:"member",status:"active" });
    const first = signInWithGoogle({ id:randomUUID(),email:"boss@tschool.tp.edu.tw",displayName:"Google 本名",
      googleSubject:"google-subject-boss",passwordHash,status:"active" });
    assert.equal(first.outcome,"existing");
    assert.equal(first.user.display_name,"Google 本名");
    assert.equal(first.user.role,"admin");
    assert.equal(first.user.google_subject,"google-subject-boss");

    const newcomer = signInWithGoogle({ id:randomUUID(),email:"new@tschool.tp.edu.tw",displayName:"新同學",
      googleSubject:"google-subject-new",passwordHash,status:"active" });
    assert.equal(newcomer.outcome,"created");
    assert.equal(newcomer.user.display_name,"新同學");
    assert.equal(newcomer.user.role,"member");

    db.prepare("UPDATE users SET role='admin' WHERE email='new@tschool.tp.edu.tw'").run();
    syncConfiguredAdmins();
    assert.equal(db.prepare("SELECT role FROM users WHERE email='new@tschool.tp.edu.tw'").get().role,"member");
    assert.equal(db.prepare("SELECT role FROM users WHERE email='boss@tschool.tp.edu.tw'").get().role,"admin");
  } finally {
    db.close();
    if (!path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error("Unexpected directory");
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});
