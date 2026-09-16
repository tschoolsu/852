import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { Pool, type PoolClient, type QueryResult } from 'pg';

type BindValue = unknown;

function placeholders(sql: string) {
  let index = 0;
  let quoted = false;
  let result = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "'") {
      result += char;
      if (quoted && sql[i + 1] === "'") {
        result += sql[++i];
      } else {
        quoted = !quoted;
      }
    } else if (char === '?' && !quoted) {
      result += `$${++index}`;
    } else {
      result += char;
    }
  }
  return result;
}

class NodeStatement {
  values: BindValue[] = [];

  constructor(
    readonly sql: string,
    private readonly database: NodeDatabase,
  ) {}

  bind(...values: BindValue[]) {
    this.values = values;
    return this;
  }

  execute(client?: PoolClient) {
    return this.database.query(this.sql, this.values, client);
  }

  async all<T>() {
    const result = await this.execute();
    return { results: result.rows as T[] };
  }

  async first<T>() {
    const result = await this.execute();
    return (result.rows[0] as T | undefined) ?? null;
  }

  async run() {
    const result = await this.execute();
    return { success: true, meta: { changes: result.rowCount ?? 0 } };
  }
}

class NodeDatabase {
  private readonly pool: Pool;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for the server runtime.');
    }
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_SIZE || '10'),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  prepare(sql: string) {
    return new NodeStatement(sql, this);
  }

  async query(sql: string, values: BindValue[], client?: PoolClient) {
    const runner = client ?? this.pool;
    return runner.query(placeholders(sql), values as never[]) as Promise<QueryResult>;
  }

  async batch(statements: NodeStatement[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const statement of statements) {
        results.push(await statement.execute(client));
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function storagePath(key: string) {
  const root = path.resolve(process.env.FILE_STORAGE_PATH || './data/files');
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid file storage key.');
  }
  return target;
}

class NodeFiles {
  async put(key: string, body: ReadableStream) {
    const target = storagePath(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
    const source = Readable.fromWeb(body as never);
    const output = createWriteStream(target, { mode: 0o640 });
    source.pipe(output);
    await finished(output);
  }

  async get(key: string) {
    const target = storagePath(key);
    try {
      await stat(target);
    } catch {
      return null;
    }
    return { body: Readable.toWeb(createReadStream(target)) as ReadableStream };
  }

  async head(key: string) {
    try {
      const info = await stat(storagePath(key));
      return { size: info.size };
    } catch {
      return null;
    }
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      await rm(storagePath(key), { force: true });
    }
  }
}

let database: NodeDatabase | undefined;
let files: NodeFiles | undefined;

export const env = new Proxy<Record<string, unknown>>(
  {},
  {
    get(_target, property) {
      if (property === 'DB') return (database ??= new NodeDatabase());
      if (property === 'FILES') return (files ??= new NodeFiles());
      return process.env[String(property)];
    },
  },
) as unknown as Cloudflare.Env;
