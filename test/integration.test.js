import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

test("Google 登入、上傳與權限流程由伺服器端強制執行", async () => {
  const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "tfiles-integration-"));
  process.env.NODE_ENV = "test";
  process.env.DATA_DIR = testDataDir;
  process.env.SESSION_SECRET = "integration-test-session-secret-at-least-32-characters";
  process.env.ALLOWED_EMAIL_DOMAIN = "tschool.tp.edu.tw";
  process.env.REGISTRATION_MODE = "instant";
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

  const [{ app }, { db,createUser,createSession }, security, { config }] = await Promise.all([
    import("../src/app.js"), import("../src/db.js"), import("../src/lib/security.js"), import("../src/config.js"),
  ]);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const loginPage = await formPage(baseUrl,"/login");
    assert.doesNotMatch(loginPage.html,/type="password"|忘記密碼|註冊/);
    assert.match(loginPage.html,/使用學校 Google 帳號登入/);
    assert.equal(loginPage.response.headers.get("cache-control"),"no-store");
    const googleStart = await fetch(`${baseUrl}/auth/google`,{redirect:"manual"});
    assert.equal(googleStart.status,302);
    const googleUrl = new URL(googleStart.headers.get("location"));
    assert.equal(googleUrl.origin,"https://accounts.google.com");
    assert.equal(googleUrl.searchParams.get("hd"),"tschool.tp.edu.tw");
    assert.equal(googleUrl.searchParams.get("code_challenge_method"),"S256");
    assert.match(googleUrl.searchParams.get("scope"),/openid/);
    assert.ok(cookieFrom(googleStart,"tfiles_oauth_states").includes(googleUrl.searchParams.get("state")));

    const passwordHash = await security.hashPassword("unusable-random-test-password");
    function account(email,displayName) {
      const user = createUser({ id:randomUUID(),email,displayName,passwordHash,role:"member",status:"active",googleSubject:`google-${email}` });
      const rawToken = `test-session-${randomUUID()}`;
      createSession({ tokenHash:security.signSessionToken(rawToken,config.sessionSecret),userId:user.id,
        csrfToken:`csrf-${randomUUID()}`,expiresAt:new Date(Date.now()+60_000).toISOString() });
      return { user,cookie:`tfiles_session=${rawToken}` };
    }
    const owner = account("owner@tschool.tp.edu.tw","檔案擁有者");
    const member = account("member@tschool.tp.edu.tw","其他成員");
    const ownerCookie = owner.cookie;
    const memberCookie = member.cookie;

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
