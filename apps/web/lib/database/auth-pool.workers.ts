// better-auth 用的连接池（Workers）：Neon 的 Pool（WebSocket），每个请求新建一个，用完关闭。
import { Pool } from "@neondatabase/serverless";

export interface AuthPool {
  pool: Pool;
  close: () => Promise<void>;
}

export function createAuthPool(databaseUrl: string): AuthPool {
  const pool = new Pool({ connectionString: databaseUrl });
  return { pool, close: () => pool.end().catch(() => undefined) };
}
