// Postgres 驱动（Node）：node-postgres 连接池，进程内复用连接；批量用事务。
// 与 Workers 版的 Neon HTTP 驱动语义一致：一个 batch 在一个事务里顺序执行。
import { Pool } from "pg";
import type { SqlClient, SqlQuery, SqlResult } from "./driver.ts";

export function createSqlClient(url: string): SqlClient {
  const pool = new Pool({ connectionString: url, max: 10, allowExitOnIdle: true });
  const run = async (query: { sql: string; params: unknown[] }): Promise<SqlResult> => {
    const result = await pool.query({
      text: query.sql,
      values: query.params as never[],
    });
    return {
      rows: result.rows as Record<string, unknown>[],
      fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rowCount: result.rowCount ?? 0,
    };
  };

  return {
    query: (sql, params) => run({ sql, params }),
    async batch(queries: SqlQuery[]): Promise<SqlResult[]> {
      if (queries.length === 0) return [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results: SqlResult[] = [];
        for (const query of queries) {
          const result = await client.query({ text: query.sql, values: query.params as never[] });
          results.push({
            rows: result.rows as Record<string, unknown>[],
            fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
            rowCount: result.rowCount ?? 0,
          });
        }
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
