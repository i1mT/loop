// Neon Postgres 适配层：保持 D1 风格的接口（prepare / bind / first / all / run / batch），业务代码不用改写法。
// 驱动：@neondatabase/serverless 的 HTTP 方式（适合 Workers，每次查询一个请求；批量用非交互事务）。
import { neon } from "@neondatabase/serverless";

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

function convert(res: { rows: Row[]; fields: { name: string; dataTypeID: number }[] }): Row[] {
  const numeric = res.fields.filter((f) => f.dataTypeID === INT8 || f.dataTypeID === NUMERIC).map((f) => f.name);
  if (numeric.length === 0) return res.rows;
  return res.rows.map((r) => {
    for (const k of numeric) if (r[k] !== null && r[k] !== undefined) r[k] = Number(r[k]);
    return r;
  });
}

type Sql = ReturnType<typeof neon>;

export class Statement {
  readonly sql: string;
  readonly params: unknown[];
  private readonly client: Sql;

  constructor(client: Sql, sql: string, params: unknown[] = []) {
    this.client = client;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: unknown[]): Statement {
    return new Statement(this.client, this.sql, params);
  }

  /** 供事务使用：未执行的查询 */
  query(): ReturnType<Sql["query"]> {
    return this.client.query(toPg(this.sql), this.params as unknown[]);
  }

  private async exec(): Promise<{ rows: Row[]; rowCount: number }> {
    const res = (await this.query()) as unknown as { rows: Row[]; fields: { name: string; dataTypeID: number }[]; rowCount: number };
    return { rows: convert(res), rowCount: res.rowCount ?? 0 };
  }

  async first<T = Row>(): Promise<T | null> {
    const { rows } = await this.exec();
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    const { rows } = await this.exec();
    return { results: rows as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const { rowCount } = await this.exec();
    return { meta: { changes: rowCount } };
  }
}

export class Db {
  private readonly client: Sql;

  constructor(url: string) {
    this.client = neon(url, { fullResults: true });
  }

  prepare(sql: string): Statement {
    return new Statement(this.client, sql);
  }

  /** 在一个事务里依次执行（非交互事务） */
  async batch(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.client.transaction(statements.map((s) => s.query()) as never);
  }
}
