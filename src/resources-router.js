import { Router } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import multer from "multer";
import { pipeline } from "node:stream/promises";
import { audit, getActiveUserByEmailOrName, searchActiveUsers } from "./db.js";
import { config } from "./config.js";
import { normalizeEmail, isAllowedSchoolEmail } from "./lib/security.js";
import { getObjectStream, removeTempFile, storeUploadedFile, removeObject, tempDir } from "./storage.js";
import {
  accessContext, getResource, grantsFor, permissionFor, canEdit, createItem, saveItem,
  setEmailGrant, removeEmailGrant, setLink, followLink, makePrivate, roleLabel,
} from "./resources-store.js";

const clean = (value,max) => typeof value === "string" ? value.trim().slice(0,max) : "";
function fail(status,message) { return Object.assign(new Error(message),{ status,publicMessage: message }); }
function parseUrl(value) {
  try {
    const url = new URL(String(value));
    if (!["http:","https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch { throw fail(400,"請輸入有效的 http:// 或 https:// 網址，不可包含帳號密碼。"); }
}
function filename(value) {
  try { return new TextDecoder("utf-8",{ fatal: true }).decode(Buffer.from(value,"latin1")).replace(/[\x00-\x1f\x7f]/g,"").slice(0,255); }
  catch { return value.replace(/[\x00-\x1f\x7f]/g,"").slice(0,255); }
}
function badgeFor(row) {
  if (row.kind === "folder") return { badge: "資料夾", badgeTone: "folder" };
  if (row.kind === "link") return { badge: "LINK", badgeTone: "link" };
  const raw = path.extname(row.original_name || "").slice(1).toUpperCase();
  const aliases = { JPEG:"JPG", TIFF:"TIF", DOCX:"DOC", XLSX:"XLS", PPTX:"PPT",
    HEIC:"IMG", WEBP:"IMG", MOV:"VIDEO", MP4:"VIDEO", AVI:"VIDEO", MP3:"AUDIO", WAV:"AUDIO" };
  const badge = aliases[raw] || (/^[A-Z0-9]{1,5}$/.test(raw) ? raw : "FILE");
  const tone = /^(JPG|PNG|GIF|SVG|TIF|IMG)$/.test(badge) ? "image"
    : /^(PDF|DOC|TXT|RTF|MD)$/.test(badge) ? "document"
    : /^(XLS|CSV)$/.test(badge) ? "sheet"
    : /^(PPT)$/.test(badge) ? "slides"
    : /^(ZIP|RAR|7Z|TAR|GZ)$/.test(badge) ? "archive"
    : /^(VIDEO|AUDIO)$/.test(badge) ? "media" : "file";
  return { badge, badgeTone:tone };
}

export function resourceRouter({ requireAuth,requireCsrf }) {
  const router = Router();
  const upload = multer({ dest: tempDir, limits: { fileSize: config.maxUploadBytes, files: 1, fields: 12, fieldSize: 8192, parts: 15 } });
  router.use(requireAuth);
  router.use((_req,res,next) => { res.setHeader("Cache-Control","no-store"); next(); });

  function checkParent(parentId,userId) {
    if (!parentId) return;
    if (getResource(parentId)?.kind !== "folder" || !canEdit(parentId,userId)) throw fail(403,"你沒有在這個資料夾新增內容的權限。");
  }
  function owned(req) {
    const item = getResource(req.params.id);
    if (!item || item.owner_id !== req.user.id) throw fail(404,"找不到項目，或你沒有管理分享的權限。");
    return item;
  }
  function requireEditor(req,_res,next) {
    if (!canEdit(req.params.id,req.user.id)) throw fail(403,"你沒有編輯這個項目的權限。");
    next();
  }
  function present(row,context) {
    const permission = context.permission(row.id);
    return { ...row, ...badgeFor(row), permission, roleLabel: roleLabel(permission),
      sharingLabel: row.parent_id ? "繼承資料夾權限" : row.link_token ? "連結共享" : row.has_shares ? "指定 Email" : row.access_level === "members" ? "所有成員（舊設定）" : "自己",
      link_token: undefined }; // Never expose link secrets in listings or recipient HTML.
  }
  function library(req,res) {
    const history = req.path === "/uploads";
    const context = accessContext(req.user.id);
    const folderId = !history ? clean(req.query.folder,64) : "";
    const folder = folderId ? context.byId.get(folderId) : null;
    if (folderId && (!folder || folder.kind !== "folder" || context.permission(folderId) === "none")) throw fail(404,"資料夾不存在，或你沒有存取權限。");
    const search = clean(req.query.q,100);
    const all = context.rows.filter(r => context.permission(r.id) !== "none");
    const resources = all.filter(row => {
      if (history) return row.owner_id === req.user.id;
      if (folder) return row.parent_id === folder.id;
      if (search) return true;
      return !row.parent_id || context.permission(row.parent_id) === "none";
    }).filter(row => !search || `${row.title} ${row.original_name || ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      .map(row => present(row,context));
    if (!history) resources.sort((a,b) => Number(b.kind === "folder") - Number(a.kind === "folder"));
    const breadcrumbs = [];
    let cursor = folder;
    const seen = new Set();
    while (cursor && !seen.has(cursor.id) && context.permission(cursor.id) !== "none") {
      seen.add(cursor.id);
      breadcrumbs.unshift({ id:cursor.id,title:cursor.title });
      cursor = context.byId.get(cursor.parent_id);
    }
    res.render("dashboard", { history,resources,folder: folder ? present(folder,context) : null,breadcrumbs,search,
      canCreate: !history && (!folder || ["owner","editor"].includes(context.permission(folder.id))) });
  }
  router.get("/app",library);
  router.get("/uploads",library);

  router.post("/resources/folders",requireCsrf,(req,res) => {
    const title = clean(req.body.title,160);
    if (!title) throw fail(400,"請輸入資料夾名稱。");
    const parentId = clean(req.body.parentId,64) || null;
    checkParent(parentId,req.user.id);
    const item = createItem({ id:randomUUID(),kind:"folder",title,description:clean(req.body.description,500),ownerId:req.user.id,parentId });
    audit(req.user.id,"resource.folder_created","resource",item.id,{ parentId });
    res.redirect(`/app?folder=${item.id}&notice=created`);
  });
  router.post("/resources/files",upload.single("file"),requireCsrf,async (req,res) => {
    let key;
    try {
      if (!req.file) throw fail(400,"請選擇一個檔案後再上傳。");
      const parentId = clean(req.body.parentId,64) || null;
      checkParent(parentId,req.user.id);
      key = randomUUID();
      await storeUploadedFile(req.file.path,key,"application/octet-stream",req.file.size);
      checkParent(parentId,req.user.id); // Permissions may change while bytes are being stored.
      const item = createItem({ id:randomUUID(),kind:"file",title:clean(req.body.title,160) || filename(req.file.originalname),
        description:clean(req.body.description,500),storageKey:key,originalName:filename(req.file.originalname),
        mimeType:"application/octet-stream",sizeBytes:req.file.size,ownerId:req.user.id,parentId });
      key = null;
      audit(req.user.id,"resource.file_created","resource",item.id,{ parentId });
      res.redirect(`/resources/${item.id}?notice=created`);
    } finally {
      await removeTempFile(req.file?.path);
      if (key) await removeObject(key);
    }
  });
  router.post("/resources/links",requireCsrf,(req,res) => {
    const title = clean(req.body.title,160);
    if (!title) throw fail(400,"請輸入連結名稱。");
    const url = parseUrl(req.body.url);
    const parentId = clean(req.body.parentId,64) || null;
    checkParent(parentId,req.user.id);
    const item = createItem({ id:randomUUID(),kind:"link",title,description:clean(req.body.description,500),url,ownerId:req.user.id,parentId });
    audit(req.user.id,"resource.link_created","resource",item.id,{ parentId });
    res.redirect(`/resources/${item.id}?notice=created`);
  });

  router.get("/s/:token",(req,res) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(req.params.token)) throw fail(404,"分享連結不存在或已失效。");
    const id = followLink(req.params.token,req.user.id);
    if (!id) throw fail(404,"分享連結不存在或已失效。");
    res.redirect(`/resources/${id}`);
  });
  router.get("/resources/:id",(req,res) => {
    const context = accessContext(req.user.id);
    const row = context.byId.get(req.params.id);
    if (!row || context.permission(row.id) === "none") throw fail(404,"項目不存在，或你沒有存取權限。");
    if (row.kind === "folder") return res.redirect(`/app?folder=${row.id}`);
    res.render("resource",{ resource:present(row,context),parent: row.parent_id && context.permission(row.parent_id) !== "none" ? context.byId.get(row.parent_id) : null });
  });
  router.get("/resources/:id/download",async (req,res) => {
    const resource = getResource(req.params.id);
    if (!resource || resource.kind !== "file" || permissionFor(resource.id,req.user.id) === "none") throw fail(404,"檔案不存在，或你沒有存取權限。");
    const stream = await getObjectStream(resource.storage_key);
    res.attachment(resource.original_name || "download");
    res.type("application/octet-stream");
    audit(req.user.id,"resource.download_started","resource",resource.id);
    await pipeline(stream,res);
  });
  router.get("/resources/:id/edit",requireEditor,(req,res) => {
    const resource = getResource(req.params.id);
    res.render("edit",{ resource,error:"" });
  });
  router.post("/resources/:id/edit",requireEditor,upload.single("file"),requireCsrf,async (req,res) => {
    let newKey;
    try {
      const resource = getResource(req.params.id);
      const title = clean(req.body.title,160);
      if (!title) throw fail(400,"請輸入名稱。");
      const revision = Number(req.body.revision);
      if (!Number.isInteger(revision) || revision !== resource.revision) throw fail(409,"此項目已被其他人更新。請重新開啟編輯頁後再儲存。");
      if (req.file && resource.kind !== "file") throw fail(400,"只有檔案項目可以替換檔案。");
      const values = { title,description:clean(req.body.description,500),url:resource.kind === "link" ? parseUrl(req.body.url) : null };
      if (req.file) {
        newKey = randomUUID();
        await storeUploadedFile(req.file.path,newKey,"application/octet-stream",req.file.size);
        Object.assign(values,{ storageKey:newKey,originalName:filename(req.file.originalname),mimeType:"application/octet-stream",sizeBytes:req.file.size });
      }
      if (!canEdit(resource.id,req.user.id)) throw fail(403,"你的編輯權限已被撤回，這次修改未儲存。");
      if (!saveItem(resource.id,revision,values)) throw fail(409,"此項目已被其他人更新。請重新開啟編輯頁後再儲存。");
      newKey = null;
      audit(req.user.id,req.file ? "resource.file_replaced" : "resource.edited","resource",resource.id);
      if (req.file) await removeObject(resource.storage_key).catch(error => console.error("Old object cleanup failed:",error.message));
      res.redirect(`/resources/${resource.id}?notice=updated`);
    } finally {
      await removeTempFile(req.file?.path);
      if (newKey) await removeObject(newKey);
    }
  });

  router.get("/resources/:id/access",(req,res) => {
    const resource = owned(req);
    res.render("access",{ resource,grants:grantsFor(resource.id),shareUrl:resource.link_token ? `${config.appUrl}/s/${resource.link_token}` : "" });
  });
  router.get("/resources/:id/share-users",(req,res) => {
    owned(req);
    const users = searchActiveUsers(req.query.q,req.user.id).filter(user => isAllowedSchoolEmail(user.email,config.allowedEmailDomain));
    res.json({ users:users.map(user => ({ email:user.email,displayName:user.display_name })) });
  });
  router.post("/resources/:id/access",requireCsrf,(req,res) => {
    const resource = owned(req);
    const action = req.body.action;
    if (action === "grant") {
      const query = clean(req.body.recipient || req.body.email,100);
      const found = getActiveUserByEmailOrName(query);
      if (found.ambiguous) throw fail(400,"有多位成員使用這個本名，請從搜尋結果選擇正確的學校信箱。");
      const recipient = found.user;
      const email = normalizeEmail(recipient?.email || "");
      if (!isAllowedSchoolEmail(email,config.allowedEmailDomain) || !recipient) throw fail(400,"找不到這位成員。只能分享給已使用學校信箱註冊且已啟用的帳號。");
      if (recipient.id === req.user.id) throw fail(400,"你已是擁有者，不需要分享給自己。");
      if (!["viewer","editor"].includes(req.body.role)) throw fail(400,"請選擇可檢視或可編輯。");
      setEmailGrant(resource.id,recipient.id,req.body.role);
    } else if (action === "remove") {
      removeEmailGrant(resource.id,clean(req.body.userId,64));
    } else if (action === "link") {
      if (!["off","viewer","editor"].includes(req.body.role)) throw fail(400,"請選擇有效的連結權限。");
      setLink(resource.id,req.body.role,req.body.rotate === "yes");
    } else if (action === "private") {
      makePrivate(resource.id);
    } else { throw fail(400,"請使用分享頁面變更權限。"); }
    audit(req.user.id,"resource.access_updated","resource",resource.id,{ action,role:req.body.role });
    res.redirect(`/resources/${resource.id}/access?notice=access`);
  });
  return router;
}
