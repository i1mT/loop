// Postgres 驱动（Workers）：Neon 的 HTTP 查询，每次查询一个请求；批量用非交互事务。
import { neon } from "@neondatabase/serverless";
import type { SqlClient, SqlResult } from "../database/driver.ts";

export function createSqlClient(url: string): SqlClient {
  const client = neon(url, { fullResults: true });
  return {
    async query(sql, params): Promise<SqlResult> {
      return (await client.query(sql, params)) as unknown as SqlResult;
    },
    async batch(queries): Promise<SqlResult[]> {
      // Neon 的非交互事务：一次网络请求里按顺序执行，要么全部成功，要么全部回滚。
      const results = await client.transaction(
        queries.map((q) => client.query(q.sql, q.params)) as never,
      );
      return results as unknown as SqlResult[];
    },
  };
}
