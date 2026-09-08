import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function cookieFrom(response, name) {
  const values = response.headers.getSetCookie();
  const match = values.find((value) => value.startsWith(`${name}=`));
  return match?.split(";", 1)[0] || "";
}

async function formPage(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  const html = await response.text();
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  return { response, html, csrf, cookie: cookieFrom(response, "tfiles_csrf") };
}

async function register(baseUrl, email, displayName) {
  const page = await formPage(baseUrl, "/register");
  const response = await fetch(`${baseUrl}/register`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: page.cookie },
    body: new URLSearchParams({
      _csrf: page.csrf,
      email,
      displayName,
      password: "correct horse battery staple",
      passwordConfirm: "correct horse battery staple",
    }),
  });
  assert.equal(response.status, 302);
}

async function login(baseUrl, email) {
  const page = await formPage(baseUrl, "/login");
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: page.cookie },
    body: new URLSearchParams({
      _csrf: page.csrf,
      email,
      password: "correct horse battery staple",
    }),
  });
  assert.equal(response.status, 302);
  return cookieFrom(response, "tfiles_session");
}

test("完整註冊、登入、上傳與權限流程由伺服器端強制執行", async () => {
  const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "tfiles-integration-"));
  process.env.NODE_ENV = "test";
  process.env.DATA_DIR = testDataDir;
  process.env.SESSION_SECRET = "integration-test-session-secret-at-least-32-characters";
  process.env.ALLOWED_EMAIL_DOMAIN = "tschool.tp.edu.tw";
  process.env.REGISTRATION_MODE = "instant";

  const [{ app }, { db }] = await Promise.all([import("../src/app.js"), import("../src/db.js")]);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await register(baseUrl, "owner@tschool.tp.edu.tw", "檔案擁有者");
    await register(baseUrl, "member@tschool.tp.edu.tw", "其他成員");
    const ownerCookie = await login(baseUrl, "owner@tschool.tp.edu.tw");
    const memberCookie = await login(baseUrl, "member@tschool.tp.edu.tw");

    const dashboard = await fetch(`${baseUrl}/app`, { headers: { cookie: ownerCookie } });
    const dashboardHtml = await dashboard.text();
    const csrf = dashboardHtml.match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert.ok(csrf);

    const upload = new FormData();
    upload.append("_csrf", csrf);
    upload.append("title", "測試機密檔案");
    upload.append("accessLevel", "private");
    upload.append("file", new Blob(["private-content"], { type: "text/plain" }), "private.txt");
    const uploadResponse = await fetch(`${baseUrl}/resources/files`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: ownerCookie },
      body: upload,
    });
    assert.equal(uploadResponse.status, 302);

    const refreshed = await fetch(`${baseUrl}/app`, { headers: { cookie: ownerCookie } });
    const refreshedHtml = await refreshed.text();
    const resourceId = refreshedHtml.match(/\/resources\/([0-9a-f-]+)\/download/)?.[1];
    assert.ok(resourceId);

    const ownerDownload = await fetch(`${baseUrl}/resources/${resourceId}/download`, { headers: { cookie: ownerCookie } });
    assert.equal(ownerDownload.status, 200);
    assert.equal(await ownerDownload.text(), "private-content");

    const deniedDownload = await fetch(`${baseUrl}/resources/${resourceId}/download`, { headers: { cookie: memberCookie } });
    assert.equal(deniedDownload.status, 404);

    const accessResponse = await fetch(`${baseUrl}/resources/${resourceId}/access`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: ownerCookie },
      body: new URLSearchParams({ _csrf: csrf, accessLevel: "members" }),
    });
    assert.equal(accessResponse.status, 302);

    const allowedDownload = await fetch(`${baseUrl}/resources/${resourceId}/download`, { headers: { cookie: memberCookie } });
    assert.equal(allowedDownload.status, 200);
    assert.equal(await allowedDownload.text(), "private-content");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await fs.rm(testDataDir, { recursive: true, force: true });
  }
});
