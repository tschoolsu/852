import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (!process.env.DATABASE_URL && existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Prisma migrations');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
