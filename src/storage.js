import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";

const objectDir = path.join(config.dataDir, "objects");
const tempDir = path.join(config.dataDir, "tmp");
fs.mkdirSync(objectDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

let s3Client;
if (config.storageDriver === "s3") {
  if (!config.s3.bucket || !config.s3.accessKeyId || !config.s3.secretAccessKey) {
    throw new Error("STORAGE_DRIVER=s3 時必須設定 S3_BUCKET、S3_ACCESS_KEY_ID 與 S3_SECRET_ACCESS_KEY");
  }
  s3Client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
}

export { tempDir };

export async function storeUploadedFile(tempPath, key, contentType, contentLength) {
  if (config.storageDriver === "s3") {
    const stream = fs.createReadStream(tempPath);
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: key,
          Body: stream,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
      );
    } finally {
      await fsp.rm(tempPath, { force: true });
    }
    return;
  }
  await fsp.rename(tempPath, path.join(objectDir, key));
}

export async function removeTempFile(tempPath) {
  if (tempPath) await fsp.rm(tempPath, { force: true });
}

export async function getObjectStream(key) {
  if (config.storageDriver === "s3") {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return response.Body;
  }
  return fs.createReadStream(path.join(objectDir, path.basename(key)));
}
