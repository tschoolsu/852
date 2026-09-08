import test from "node:test";
import assert from "node:assert/strict";
import { canAccessResource, normalizeAccessLevel } from "../src/lib/access.js";

const owned = { owner_id: "owner", access_level: "private" };

test("擁有者永遠可以存取自己的項目", () => {
  assert.equal(canAccessResource(owned, "owner"), true);
});

test("私人、指定成員與全體成員權限彼此隔離", () => {
  assert.equal(canAccessResource(owned, "member"), false);
  assert.equal(canAccessResource({ ...owned, access_level: "selected" }, "member", ["member"]), true);
  assert.equal(canAccessResource({ ...owned, access_level: "selected" }, "other", ["member"]), false);
  assert.equal(canAccessResource({ ...owned, access_level: "members" }, "other"), true);
});

test("未知權限值安全地降級為僅自己", () => {
  assert.equal(normalizeAccessLevel("public"), "private");
});
