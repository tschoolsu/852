#!/usr/bin/env node
// Run as the service user. Keep backups outside the repository and public web root.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const envFile = process.env.TFILES_ENV_FILE || '/home/service/t-files-data/.env';
process.loadEnvFile(envFile);
const storage = path.resolve(process.env.FILE_STORAGE_PATH || '');
const backupDir = path.resolve(process.env.TFILES_BACKUP_DIR || '/home/service/t-files-data/backups');
const retentionDays = Number(process.env.TFILES_BACKUP_RETENTION_DAYS || 14);
if (!process.env.DATABASE_URL || !process.env.FILE_STORAGE_PATH || !fs.statSync(storage).isDirectory()) {
  throw new Error('DATABASE_URL and an existing FILE_STORAGE_PATH are required');
}
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
  throw new Error('Invalid TFILES_BACKUP_RETENTION_DAYS');
}
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
fs.chmodSync(backupDir, 0o700);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const prefix = `t-files-${stamp}`;
const stage = fs.mkdtempSync(path.join(backupDir, '.pending-'));
fs.chmodSync(stage, 0o700);
const run = (command, args) => {
  const result = spawnSync(command, args, { env: process.env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || '').slice(0, 1000)}`);
};
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try {
  const db = path.join(stage, `${prefix}.dump`);
  const files = path.join(stage, `${prefix}.files.tar.gz`);
  run('pg_dump', ['--format=custom', '--no-owner', '--file', db, process.env.DATABASE_URL]);
  run('tar', ['--create', '--gzip', '--file', files, '--directory', storage, '.']);
  run('pg_restore', ['--list', db]);
  run('tar', ['--list', '--gzip', '--file', files]);
  const manifest = {
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    database: { file: path.basename(db), bytes: fs.statSync(db).size, sha256: digest(db) },
    files: { file: path.basename(files), bytes: fs.statSync(files).size, sha256: digest(files) },
  };
  const manifestFile = path.join(stage, `${prefix}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  for (const source of [db, files, manifestFile]) {
    fs.chmodSync(source, 0o600);
    fs.renameSync(source, path.join(backupDir, path.basename(source)));
  }
  const cutoff = Date.now() - retentionDays * 86400_000;
  for (const name of fs.readdirSync(backupDir)) {
    if (!/^t-files-\d{4}-\d{2}-\d{2}T.*\.(dump|files\.tar\.gz|json)$/.test(name)) continue;
    const file = path.join(backupDir, name);
    if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
  }
  console.log(`Backup complete: ${prefix}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
