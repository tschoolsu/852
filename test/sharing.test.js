import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

test("多使用者的共享、資料夾、編輯及畫面情境", async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),"tfiles-sharing-"));
  Object.assign(process.env,{ NODE_ENV:"test",DATA_DIR:dataDir,SESSION_SECRET:"sharing-test-secret-with-more-than-32-characters",REGISTRATION_MODE:"instant",STORAGE_DRIVER:"local",SMTP_HOST:"",ADMIN_EMAILS:"" });
  const { app } = await import("../src/app.js");
  const { db,createUser,getUserByEmail,createSession } = await import("../src/db.js");
  const { hashPassword,signSessionToken,createOpaqueToken } = await import("../src/lib/security.js");
  const { config } = await import("../src/config.js");
  const { getResource,listVersions } = await import("../src/resources-store.js");
  const server = app.listen(0,"127.0.0.1");
  await new Promise(resolve => server.once("listening",resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function get(route,who) {
    const res = await fetch(base+route,{ redirect:"manual",headers:{ cookie:who?.cookie || "" } });
    const html = await res.text();
    return { res,html,csrf:html.match(/name="_csrf" value="([^"]+)"/)?.[1] };
  }
  async function post(route,who,fields,multipart=false,expected=302) {
    const payload = multipart ? new FormData() : new URLSearchParams();
    payload.set("_csrf",who.csrf);
    for (const [key,value] of Object.entries(fields)) {
      if (value instanceof Blob) payload.set(key,value,"新版檔案.txt"); else payload.set(key,String(value));
    }
    const res = await fetch(base+route,{ method:"POST",redirect:"manual",headers:{ cookie:who.cookie,...(!multipart ? {"content-type":"application/x-www-form-urlencoded"} : {}) },body:payload });
    const html = await res.text();
    assert.equal(res.status,expected,`${route}: ${html.slice(-600)}`);
    return { res,html };
  }
  async function account(local,name) {
    const email = local+"@tschool.tp.edu.tw";
    const user = createUser({ id:randomUUID(),email,displayName:name,passwordHash:await hashPassword(createOpaqueToken()),role:"member",status:"active",googleSubject:`google-${local}` });
    const rawToken = createOpaqueToken();
    createSession({ tokenHash:signSessionToken(rawToken,config.sessionSecret),userId:user.id,csrfToken:createOpaqueToken(24),expiresAt:new Date(Date.now()+60_000).toISOString() });
    let who = { email,cookie:`tfiles_session=${rawToken}` };
    who.csrf = (await get("/app",who)).csrf;
    who.id = getUserByEmail(email).id;
    return who;
  }
  const itemId = result => result.res.headers.get("location").match(/(?:resources\/|folder=)([0-9a-f-]{36})/)[1];
  const grant = (id,email,role="viewer") => post(`/resources/${id}/access`,owner,{ action:"grant",email,role });
  const edit = (id,who,fields={},expected=302) => post(`/resources/${id}/edit`,who,{ revision:getResource(id).revision,title:getResource(id).title,description:"",...(getResource(id).kind === "link" ? {url:getResource(id).url} : {}),...fields },true,expected);
  let owner,viewer,editor,other,file,folder,child,subfolder,link;
  try {
    owner = await account("qa-owner","擁有者甲");
    viewer = await account("qa-viewer","檢視者乙");
    editor = await account("qa-editor","編輯者丙");
    other = await account("qa-other","其他同學丁");
    await t.test("新帳號看到空白檔案庫與自己的空白上傳紀錄",async () => {
      assert.match((await get("/app",other)).html,/目前沒有可存取的內容/);
      assert.match((await get("/uploads",other)).html,/你還沒有建立內容/);
    });
    file = itemId(await post("/resources/files",owner,{ title:"甲的私人檔案",file:new Blob(["original bytes"]) },true));
    await t.test("私人檔案只出現在擁有者畫面；猜網址或搜尋都不外洩",async () => {
      assert.match((await get("/app",owner)).html,/甲的私人檔案/);
      for (const who of [viewer,editor,other]) {
        assert.doesNotMatch((await get("/app",who)).html,/甲的私人檔案/);
        assert.doesNotMatch((await get("/app?q=甲的私人檔案",who)).html,/resource-row/);
        assert.equal((await get(`/resources/${file}`,who)).res.status,404);
        assert.equal((await get(`/resources/${file}/download`,who)).res.status,404);
      }
    });
    await t.test("未知、校外、未啟用的 Email 與錯誤角色不會獲得共享",async () => {
      const hash = await hashPassword("Eight!42");
      for(const status of ["pending","disabled"]) createUser({ id:randomUUID(),email:`${status}@tschool.tp.edu.tw`,displayName:status,passwordHash:hash,role:"member",status });
      for (const email of ["missing@tschool.tp.edu.tw","outsider@example.com","pending@tschool.tp.edu.tw","disabled@tschool.tp.edu.tw"]) {
        await post(`/resources/${file}/access`,owner,{ action:"grant",email,role:"editor" },false,400);
      }
      await post(`/resources/${file}/access`,owner,{ action:"grant",email:viewer.email,role:"owner" },false,400);
    });
    await t.test("共享欄位可用本名或信箱搜尋，但只有擁有者能查詢名單",async () => {
      const search = await get(`/resources/${file}/share-users?q=${encodeURIComponent("檢視者")}`,owner);
      assert.equal(search.res.status,200);
      assert.deepEqual(JSON.parse(search.html).users,[{email:viewer.email,displayName:"檢視者乙"}]);
      assert.equal((await get(`/resources/${file}/share-users?q=qa`,viewer)).res.status,404);
      await post(`/resources/${file}/access`,owner,{action:"grant",recipient:"其他同學丁",role:"viewer"});
      assert.equal((await get(`/resources/${file}`,other)).res.status,200);
      await post(`/resources/${file}/access`,owner,{action:"remove",userId:other.id});
      createUser({id:randomUUID(),email:"same-name@tschool.tp.edu.tw",displayName:"其他同學丁",passwordHash:getUserByEmail(other.email).password_hash,role:"member",status:"active"});
      await post(`/resources/${file}/access`,owner,{action:"grant",recipient:"其他同學丁",role:"viewer"},false,400);
    });
    await grant(file,viewer.email.toUpperCase());
    await grant(file,editor.email,"editor");
    await t.test("Email 共享按角色顯示按鈕，檢視者不能編輯或管理共享",async () => {
      const view = (await get(`/resources/${file}`,viewer)).html;
      assert.match(view,/可檢視/);
      assert.doesNotMatch(view,new RegExp(`/resources/${file}/(?:edit|access)`));
      assert.equal((await get(`/resources/${file}/edit`,viewer)).res.status,403);
      await edit(file,viewer,{title:"不應儲存"},403);
      for (const who of [viewer,editor]) await post(`/resources/${file}/access`,who,{ action:"link",role:"editor" },false,404);
      assert.equal((await get(`/resources/${file}/download`,viewer)).html,"original bytes");
      assert.match((await get(`/resources/${file}`,editor)).html,/可編輯/);
    });
    await t.test("編輯者可改名稱、說明、替換二進位檔案，擁有者看見新版",async () => {
      await edit(file,editor,{title:"丙更新的檔案",description:"新說明",file:new Blob(["updated bytes"]) });
      const page = (await get(`/resources/${file}`,owner)).html;
      assert.match(page,/丙更新的檔案/);assert.match(page,/新說明/);assert.match(page,/新版檔案.txt/);
      assert.equal((await get(`/resources/${file}/download`,viewer)).html,"updated bytes");
      assert.equal(getResource(file).owner_id,owner.id);
      assert.equal((await fs.readdir(path.join(dataDir,"objects"))).length,2);
    });
    await t.test("過期編輯表單返回 409，避免覆蓋另一人的修改",async () => {
      const stale = getResource(file).revision;
      await edit(file,owner,{description:"甲的新版本"});
      await edit(file,editor,{revision:stale,title:"過期的修改",file:new Blob(["should not replace"])},409);
      assert.equal(getResource(file).description,"甲的新版本");
      assert.equal((await get(`/resources/${file}/download`,owner)).html,"updated bytes");
      assert.equal((await fs.readdir(path.join(dataDir,"tmp"))).length,0);
    });
    await t.test("保留完整檔案版本並可還原舊檔內容",async () => {
      const versions = listVersions(file);
      assert.ok(versions.length >= 3);
      assert.match((await get(`/resources/${file}/versions`,owner)).html,/版本紀錄/);
      assert.equal((await get(`/resources/${file}/versions/1/download`,owner)).html,"original bytes");
      await post(`/resources/${file}/versions/1/restore`,owner,{});
      assert.equal((await get(`/resources/${file}/download`,owner)).html,"original bytes");
      assert.equal(listVersions(file)[0].event,"restored");
    });
    link = itemId(await post("/resources/links",owner,{title:"活動網站",url:"https://example.org/"}));
    await grant(link,editor.email,"editor");
    await t.test("編輯者能改連結，拒絕 javascript URL 並編碼 HTML",async () => {
      await edit(link,editor,{url:"https://example.org/new",title:"<script>alert(1)</script>"});
      const html = (await get(`/resources/${link}`,owner)).html;
      assert.match(html,/https:\/\/example.org\/new/);assert.doesNotMatch(html,/<script>alert/);
      assert.match(html,/&lt;script&gt;/);
      await edit(link,editor,{url:"javascript:alert(1)"},400);
    });
    let token;
    await t.test("分享連結必須登入，未持有連結者看不到項目或權杖",async () => {
      await post(`/resources/${link}/access`,owner,{action:"link",role:"viewer"});
      token = getResource(link).link_token;
      const anon = await get(`/s/${token}`);
      assert.equal(anon.res.status,302);
      assert.equal(anon.res.headers.get("location"),`/login?next=${encodeURIComponent(`/s/${token}`)}`);
      const loginHtml = (await get(anon.res.headers.get("location"))).html;
      assert.ok(loginHtml.includes(encodeURIComponent(`/s/${token}`)));
      assert.equal((await get(`/resources/${link}`,other)).res.status,404);
      assert.ok(!(await get("/app",owner)).html.includes(token));
      assert.equal((await get(`/s/${"x".repeat(43)}`,other)).res.status,404);
      assert.equal((await get(`/s/${token}`,other)).res.status,302);
      assert.match((await get(`/resources/${link}`,other)).html,/可檢視/);
    });
    await t.test("連結角色即時生效，重新產生和關閉會撤回舊連結權限",async () => {
      await post(`/resources/${link}/access`,owner,{action:"link",role:"editor"});
      await edit(link,other,{description:"從分享連結編輯"});
      await post(`/resources/${link}/access`,owner,{action:"link",role:"viewer"});
      await edit(link,other,{},403);
      await post(`/resources/${link}/access`,owner,{action:"link",role:"viewer",rotate:"yes"});
      assert.equal((await get(`/s/${token}`,other)).res.status,404);
      assert.equal((await get(`/resources/${link}`,other)).res.status,404);
      token = getResource(link).link_token;
      await get(`/s/${token}`,other);
      await post(`/resources/${link}/access`,owner,{action:"link",role:"off"});
      assert.equal((await get(`/resources/${link}`,other)).res.status,404);
      assert.match((await get(`/resources/${link}`,editor)).html,/可編輯/); // Explicit grant survives link revocation.
    });
    folder = itemId(await post("/resources/folders",owner,{title:"共享活動資料夾"}));
    subfolder = itemId(await post("/resources/folders",owner,{title:"活動子資料夾",parentId:folder}));
    child = itemId(await post("/resources/files",owner,{title:"子資料夾內的檔案",parentId:subfolder,file:new Blob(["nested bytes"])},true));
    await grant(folder,viewer.email);
    await grant(folder,editor.email,"editor");
    await t.test("擁有者可以在資料夾與檔案庫最上層之間移動項目",async () => {
      await post(`/resources/${link}/move`,owner,{parentId:folder});
      assert.equal(getResource(link).parent_id,folder);
      assert.match((await get(`/app?folder=${folder}`,owner)).html,/&lt;script&gt;alert/);
      await post(`/resources/${link}/move`,owner,{parentId:""});
      assert.equal(getResource(link).parent_id,null);
      assert.equal(listVersions(link)[0].event,"moved");
      await post(`/resources/${folder}/move`,owner,{parentId:subfolder},false,400);
      await post(`/resources/${link}/move`,editor,{parentId:folder},false,404);
    });
    await t.test("刪除會進垃圾桶，其他成員立即失去存取，擁有者可還原",async () => {
      await post(`/resources/${link}/trash`,owner,{});
      assert.equal((await get(`/resources/${link}`,editor)).res.status,404);
      assert.match((await get("/trash",owner)).html,/&lt;script&gt;alert/);
      await post(`/resources/${link}/restore`,owner,{});
      assert.equal((await get(`/resources/${link}`,editor)).res.status,200);
    });
    await t.test("垃圾桶中的檔案可以永久刪除，包含所有保留版本",async () => {
      const disposable = itemId(await post("/resources/files",owner,{title:"可永久刪除",file:new Blob(["delete me"])},true));
      const before = (await fs.readdir(path.join(dataDir,"objects"))).length;
      await post(`/resources/${disposable}/trash`,owner,{});
      await post(`/resources/${disposable}/delete-permanently`,owner,{});
      assert.equal(getResource(disposable),undefined);
      assert.equal((await fs.readdir(path.join(dataDir,"objects"))).length,before-1);
    });
    await t.test("資料夾權限遞迴套用，檢視者能瀏覽麵包屑但不能新增",async () => {
      const page = (await get(`/app?folder=${subfolder}`,viewer)).html;
      assert.match(page,/共享活動資料夾/);assert.match(page,/子資料夾內的檔案/);
      assert.doesNotMatch(page,/data-create-open/);
      assert.equal((await get(`/resources/${child}/download`,viewer)).html,"nested bytes");
      await post("/resources/folders",viewer,{title:"不准新增",parentId:folder},false,403);
      await post("/resources/files",viewer,{parentId:folder,file:new Blob(["denied"])},true,403);
      assert.equal((await fs.readdir(path.join(dataDir,"tmp"))).length,0);
      assert.equal((await get(`/app?folder=${folder}`,other)).res.status,404);
    });
    let contribution;
    await t.test("編輯者可新增子資料夾和檔案，原資料夾擁有者看見貢獻",async () => {
      const contributedFolder = itemId(await post("/resources/folders",editor,{title:"丙建立的資料夾",parentId:folder}));
      contribution = itemId(await post("/resources/files",editor,{title:"丙上傳的貢獻",parentId:contributedFolder,file:new Blob(["contribution"])},true));
      assert.match((await get(`/app?folder=${folder}`,owner)).html,/丙建立的資料夾/);
      assert.equal((await get(`/resources/${contribution}/download`,owner)).html,"contribution");
      await edit(contribution,owner,{description:"甲可依資料夾權限編輯"});
      await edit(folder,editor,{title:"編輯後的資料夾"});
    });
    await t.test("我的上傳紀錄只屬於自己，包含資料夾與共享夾內貢獻",async () => {
      const mine = (await get("/uploads",owner)).html;
      assert.match(mine,/子資料夾內的檔案/);assert.match(mine,/編輯後的資料夾/);
      assert.doesNotMatch(mine,/丙上傳的貢獻|丙建立的資料夾/);
      const editorHistory = (await get("/uploads",editor)).html;
      assert.match(editorHistory,/丙上傳的貢獻/);assert.match(editorHistory,/丙建立的資料夾/);
      assert.doesNotMatch(editorHistory,/丙更新的檔案/); // Editing does not transfer ownership.
      assert.doesNotMatch((await get(`/uploads?userId=${owner.id}`,viewer)).html,/子資料夾內的檔案/);
    });
    await t.test("可建立者看到右下角新增選單，檔案顯示副檔名格式",async () => {
      const page = (await get("/app",owner)).html;
      assert.match(page,/class="create-fab"/);
      assert.match(page,/data-create-kind="file"/);
      assert.match(page,/data-create-kind="link"/);
      assert.match(page,/data-create-kind="folder"/);
      assert.match(page,/class="resource-kind document"[^>]*>TXT</);
    });
    await t.test("只分享子項目時不暴露私人上層名稱或其他兄弟項目",async () => {
      await grant(child,other.email);
      assert.match((await get("/app",other)).html,/子資料夾內的檔案/);
      assert.doesNotMatch((await get(`/resources/${child}`,other)).html,/活動子資料夾|編輯後的資料夾/);
      assert.equal((await get(`/app?folder=${subfolder}`,other)).res.status,404);
    });
    await t.test("撤回資料夾共享立即影響子項目，較高個別權限仍保留",async () => {
      await grant(child,viewer.email,"editor");
      await post(`/resources/${folder}/access`,owner,{action:"remove",userId:viewer.id});
      assert.equal((await get(`/app?folder=${folder}`,viewer)).res.status,404);
      await edit(child,viewer,{description:"保留個別的可編輯權限"});
      await post(`/resources/${child}/access`,owner,{action:"remove",userId:viewer.id});
      assert.equal((await get(`/resources/${child}`,viewer)).res.status,404);
    });
    await t.test("共享資料夾連結同樣繼承且可立即撤銷",async () => {
      await post(`/resources/${folder}/access`,owner,{action:"link",role:"viewer"});
      const folderToken = getResource(folder).link_token;
      await get(`/s/${folderToken}`,other);
      assert.equal((await get(`/resources/${contribution}/download`,other)).res.status,200);
      await post(`/resources/${folder}/access`,owner,{action:"link",role:"off"});
      assert.equal((await get(`/resources/${contribution}/download`,other)).res.status,404);
    });
    await t.test("CSRF 缺失或無效拒絕寫入並清除暫存檔",async () => {
      await post(`/resources/${file}/access`,{...owner,csrf:"bad"},{action:"link",role:"editor"},false,403);
      await post("/resources/files",{...owner,csrf:""},{file:new Blob(["csrf failure"])},true,403);
      assert.equal((await fs.readdir(path.join(dataDir,"tmp"))).length,0);
    });
    await t.test("停用帳號即使留有 Cookie 和分享連結也不能繼續存取",async () => {
      db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(editor.id);
      assert.equal((await get(`/resources/${file}/download`,editor)).res.status,302);
      assert.equal((await get("/app",editor)).res.status,302);
    });
    await t.test("恢復自己模式會移除 Email 與連結共享",async () => {
      await post(`/resources/${file}/access`,owner,{action:"private"});
      assert.equal((await get(`/resources/${file}`,viewer)).res.status,404);
      assert.equal((await get(`/resources/${file}`,owner)).res.status,200);
    });
    await t.test("共享資料夾進垃圾桶時不會連帶隱藏其他人擁有的內容",async () => {
      db.prepare("UPDATE users SET status='active' WHERE id=?").run(editor.id);
      await post(`/resources/${folder}/trash`,owner,{});
      assert.equal((await get(`/app?folder=${folder}`,owner)).res.status,404);
      assert.equal((await get(`/resources/${contribution}`,editor)).res.status,200);
      assert.equal(getResource(contribution).parent_id !== null,true);
      await post(`/resources/${folder}/restore`,owner,{});
      assert.equal((await get(`/app?folder=${folder}`,owner)).res.status,200);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    if (!path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep)) throw new Error("Unexpected test directory");
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});
