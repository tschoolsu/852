#!/usr/bin/env node
// Restore a backup into an existing disposable database. Never points at production.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const manifestFile = process.argv[2];
const scratchName = process.argv[3];
if (!manifestFile || !/^t_files_restore_check(?:_[a-z0-9]+)?$/.test(scratchName || '')) {
  throw new Error('Usage: node restore-smoke.mjs MANIFEST.json t_files_restore_check');
}
process.loadEnvFile(process.env.TFILES_ENV_FILE || '/home/service/t-files-data/.env');
const production = new URL(process.env.DATABASE_URL);
if (production.pathname === `/${scratchName}`) throw new Error('Refusing to restore into production');
const scratch = new URL(production);
scratch.pathname = `/${scratchName}`;
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const directory = path.dirname(manifestFile);
for (const item of [manifest.database, manifest.files]) {
  if (path.basename(item.file) !== item.file) throw new Error('Invalid backup filename');
  const file = path.join(directory, item.file);
  if (fs.statSync(file).size !== item.bytes || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== item.sha256) {
    throw new Error(`Backup checksum mismatch: ${item.file}`);
  }
}
const run = (command, args) => {
  const result = spawnSync(command, args, { env: process.env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || '').slice(0, 1000)}`);
  return result.stdout.trim();
};
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't-files-restore-'));
try {
  run('pg_restore', ['--no-owner', '--no-acl', '--dbname', scratch.toString(), path.join(directory, manifest.database.file)]);
  run('tar', ['--extract', '--gzip', '--file', path.join(directory, manifest.files.file), '--directory', temp]);
  const counts = run('psql', ['--no-psqlrc', '--tuples-only', '--dbname', scratch.toString(), '--command', 'SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM resources);']);
  console.log(`Restore verified: ${counts.replace(/\s+/g, ' ').trim()} (users | resources)`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
