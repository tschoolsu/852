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

async function formPage(baseUrl, route, existingCookie = "") {
  const response = await fetch(`${baseUrl}${route}`, { headers: existingCookie ? { cookie:existingCookie } : {} });
  const html = await response.text();
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  return { response, html, csrf, cookie: cookieFrom(response, "tfiles_csrf") };
}

async function register(baseUrl, email, displayName, createVerifiedRegistration, hashToken) {
  const rawToken = `verified-${email.replace(/[^a-z]/g,"")}`;
  createVerifiedRegistration({ tokenHash:hashToken(rawToken),email,displayName,googleSubject:`google-${email}`,
    expiresAt:new Date(Date.now()+60_000).toISOString() });
  const registrationCookie = `tfiles_registration=${rawToken}`;
  const page = await formPage(baseUrl, "/register/complete",registrationCookie);
  assert.match(page.html,new RegExp(displayName));
  assert.match(page.html,new RegExp(email.replaceAll(".","\\.")));
  assert.doesNotMatch(page.html,/name="displayName"/);
  const response = await fetch(`${baseUrl}/register/complete`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${registrationCookie}; ${page.cookie}` },
    body: new URLSearchParams({
      _csrf: page.csrf,
      password: "Eight!42",
      passwordConfirm: "Eight!42",
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
      password: "Eight!42",
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
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

  const [{ app }, { db,createVerifiedRegistration }, { hashToken }] = await Promise.all([
    import("../src/app.js"), import("../src/db.js"), import("../src/lib/security.js"),
  ]);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const registerPage = await formPage(baseUrl,"/register");
    assert.doesNotMatch(registerPage.html,/name="displayName"/);
    assert.match(registerPage.html,/使用學校 Google 帳號驗證/);
    const googleStart = await fetch(`${baseUrl}/auth/google/register`,{redirect:"manual"});
    assert.equal(googleStart.status,302);
    const googleUrl = new URL(googleStart.headers.get("location"));
    assert.equal(googleUrl.origin,"https://accounts.google.com");
    assert.equal(googleUrl.searchParams.get("hd"),"tschool.tp.edu.tw");
    assert.equal(googleUrl.searchParams.get("code_challenge_method"),"S256");
    assert.match(googleUrl.searchParams.get("scope"),/openid/);
    assert.equal(googleUrl.searchParams.get("state"),cookieFrom(googleStart,"tfiles_oauth_state").split("=")[1]);

    await register(baseUrl, "owner@tschool.tp.edu.tw", "檔案擁有者",createVerifiedRegistration,hashToken);
    await register(baseUrl, "member@tschool.tp.edu.tw", "其他成員",createVerifiedRegistration,hashToken);
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
      body: new URLSearchParams({ _csrf: csrf, action: "grant", email: "member@tschool.tp.edu.tw", role: "viewer" }),
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
