import crypto from 'node:crypto';
import { env } from '../lib/node-env.ts';

if (process.env.FILE_SCAN_MODE !== 'clamd') throw new Error('Run only when clamd scanning is enabled');
const files = env.FILES;
const cleanKey = `scan-smoke/${crypto.randomUUID()}`;
const alertKey = `scan-smoke/${crypto.randomUUID()}`;
const eicar = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');
try {
  await files.put(cleanKey, new Blob(['T-Files scan smoke test']).stream());
  if (!(await files.head(cleanKey))) throw new Error('Clean file was not stored');
  let rejected = false;
  try { await files.put(alertKey, new Blob([eicar]).stream()); }
  catch (error) { rejected = /未通過惡意程式掃描/.test(String(error)); }
  if (!rejected || await files.head(alertKey)) throw new Error('Test signature was not rejected and removed');
  console.log('File scan smoke test passed');
} finally {
  await files.delete([cleanKey, alertKey]);
}
