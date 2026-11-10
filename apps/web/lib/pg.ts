// Neon Postgres 适配层：保持 D1 风格的接口（prepare / bind / first / all / run / batch），业务代码不用改写法。
// 底层驱动按部署形态切换：Workers 用 Neon HTTP（每次查询一个请求），Node 用 node-postgres 连接池。
import { createSqlClient } from "#loop-db-driver";
import type { SqlClient, SqlResult } from "./database/driver.ts";

type Row = Record<string, unknown>;
const INT8 = 20; // bigint：驱动默认返回字符串，这里转成数字（毫秒时间戳在 2^53 以内）
const NUMERIC = 1700;

/** 把 ? 占位符换成 $1、$2…；字符串字面量里的 ? 不动 */
export function toPg(sql: string): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else if (c === "?") {
      out += `$${++n}`;
    } else out += c;
  }
  return out;
}

function convert(res: SqlResult): Row[] {
  const numeric = res.fields.filter((f) => f.dataTypeID === INT8 || f.dataTypeID === NUMERIC).map((f) => f.name);
  if (numeric.length === 0) return res.rows;
  return res.rows.map((r) => {
    for (const k of numeric) if (r[k] !== null && r[k] !== undefined) r[k] = Number(r[k]);
    return r;
  });
}

export class Statement {
  readonly sql: string;
  readonly params: unknown[];
  private readonly client: SqlClient;

  constructor(client: SqlClient, sql: string, params: unknown[] = []) {
    this.client = client;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: unknown[]): Statement {
    return new Statement(this.client, this.sql, params);
  }

  /** 供事务使用：未执行的查询（已换成 $n 占位符） */
  query(): { sql: string; params: unknown[] } {
    return { sql: toPg(this.sql), params: this.params };
  }

  private async exec(): Promise<SqlResult> {
    const query = this.query();
    return this.client.query(query.sql, query.params);
  }

  async first<T = Row>(): Promise<T | null> {
    const res = await this.exec();
    const rows = convert(res);
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    const res = await this.exec();
    return { results: convert(res) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const res = await this.exec();
    return { meta: { changes: res.rowCount } };
  }
}

export class Db {
  private readonly client: SqlClient;

  constructor(url: string) {
    this.client = createSqlClient(url);
  }

  prepare(sql: string): Statement {
    return new Statement(this.client, sql);
  }

  /** 返回各语句的结果，用于事务锁之后重新验证权限并写入。 */
  async batchReturning(statements: Statement[]): Promise<{ rows: Row[]; rowCount: number }[]> {
    if (statements.length === 0) return [];
    const results = await this.client.batch(statements.map((s) => s.query()));
    return results.map((result) => ({ rows: convert(result), rowCount: result.rowCount }));
  }

  /** 在一个事务里依次执行（非交互事务） */
  async batch(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.client.batch(statements.map((s) => s.query()));
  }
}
