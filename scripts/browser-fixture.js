// Disposable local browser fixture. No demo routes or credentials are added to the real app.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID,randomBytes } from "node:crypto";

const dir = await fs.mkdtemp(path.join(os.tmpdir(),"tfiles-browser-"));
Object.assign(process.env,{NODE_ENV:"test",DATA_DIR:dir,SESSION_SECRET:randomBytes(32).toString("hex"),
  HOST:"127.0.0.1",PORT:"3100",APP_URL:"http://127.0.0.1:3100",STORAGE_DRIVER:"local",SMTP_HOST:"",ADMIN_EMAILS:"",REGISTRATION_MODE:"instant"});
const { app } = await import("../src/app.js");
const { createUser,db } = await import("../src/db.js");
const { hashPassword } = await import("../src/lib/security.js");
const { createItem,setEmailGrant,setLink } = await import("../src/resources-store.js");
const { storeUploadedFile,tempDir } = await import("../src/storage.js");
const passwordHash = await hashPassword("Demo!852");
const users = {};
for (const [name,label] of [["owner","測試擁有者"],["viewer","測試檢視者"],["editor","測試編輯者"],["other","測試其他同學"]]) {
  users[name] = createUser({id:randomUUID(),email:`qa-${name}@tschool.tp.edu.tw`,displayName:label,passwordHash,role:"member",status:"active"});
}
const make = (owner,kind,title,extras={}) => createItem({id:randomUUID(),ownerId:users[owner].id,kind,title,...extras});
const secret = make("owner","link","只有擁有者能看見的預算",{url:"https://example.org/private"});
const folder = make("owner","folder","迎新活動共用資料夾",{description:"大家在這裡整理迎新活動資料。"});
setEmailGrant(folder.id,users.viewer.id,"viewer");setEmailGrant(folder.id,users.editor.id,"editor");
const child = make("editor","folder","編輯者建立的子資料夾",{parentId:folder.id});
const key = randomUUID();
const tmpFile = path.join(tempDir,key);
await fs.writeFile(tmpFile,"這是多使用者介面測試用的檔案內容。\n");
const size = (await fs.stat(tmpFile)).size;
await storeUploadedFile(tmpFile,key,"text/plain",size);
make("editor","file","編輯者上傳的流程表",{parentId:child.id,storageKey:key,originalName:"流程表.txt",mimeType:"text/plain",sizeBytes:size});
make("viewer","link","檢視者自己的筆記",{url:"https://example.org/notes"});
const shared = make("owner","link","學生會共同參考連結",{url:"https://example.org/council"});
setEmailGrant(shared.id,users.viewer.id,"viewer");setEmailGrant(shared.id,users.editor.id,"editor");
setLink(shared.id,"viewer");
const server = app.listen(3100,"127.0.0.1",() => console.log("QA ready: http://127.0.0.1:3100/login\nAccounts: qa-owner / qa-viewer / qa-editor / qa-other @tschool.tp.edu.tw\nPassword: Demo!852\nDisposable data: "+dir));
async function close() {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  db.close();
  if (path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)) await fs.rm(dir,{recursive:true,force:true});
  process.exit(0);
}
process.once("SIGINT",close);process.once("SIGTERM",close);
