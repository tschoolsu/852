import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  isAllowedSchoolEmail,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "../src/lib/security.js";

test("只接受指定學校網域，且不接受相似網域", () => {
  assert.equal(isAllowedSchoolEmail("member@tschool.tp.edu.tw", "tschool.tp.edu.tw"), true);
  assert.equal(isAllowedSchoolEmail(" MEMBER@TSCHOOL.TP.EDU.TW ", "tschool.tp.edu.tw"), true);
  assert.equal(isAllowedSchoolEmail("member@fake-tschool.tp.edu.tw", "tschool.tp.edu.tw"), false);
  assert.equal(isAllowedSchoolEmail("member@tschool.tp.edu.tw.example.com", "tschool.tp.edu.tw"), false);
  assert.equal(normalizeEmail(" Member@TSchool.tp.edu.tw "), "member@tschool.tp.edu.tw");
});

test("密碼長度符合 OWASP 友善原則", () => {
  assert.equal(validatePassword("short"), "密碼至少需要 15 個字元");
  assert.equal(validatePassword("長密碼可以包含 空格 與各種字元"), null);
  assert.match(validatePassword("a".repeat(129)), /128/);
});

test("密碼雜湊可驗證正確密碼並拒絕錯誤密碼", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
  assert.equal(encoded.includes("correct horse battery staple"), false);
});
