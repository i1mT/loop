// better-auth 用的连接池（Node）：node-postgres 连接池，进程内复用连接（不需要每条请求新建）。
import { Pool } from "pg";

export interface AuthPool {
  pool: Pool;
  close: () => Promise<void>;
}

export function createAuthPool(databaseUrl: string): AuthPool {
  const pool = new Pool({ connectionString: databaseUrl, max: 10, allowExitOnIdle: true });
  return { pool, close: () => pool.end().catch(() => undefined) };
}
