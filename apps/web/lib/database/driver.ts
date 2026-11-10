// Postgres 驱动的窄接口：业务层与测试都不关心底层是 Neon HTTP 还是 node-postgres。
// 字段的 dataTypeID 用于把 bigint/numeric 转成 number（毫秒时间戳在 2^53 以内）。
export interface SqlField {
  name: string;
  dataTypeID: number;
}

export interface SqlResult {
  rows: Record<string, unknown>[];
  fields: SqlField[];
  rowCount: number;
}

export interface SqlQuery {
  sql: string;
  params: unknown[];
}

export interface SqlClient {
  query(sql: string, params: unknown[]): Promise<SqlResult>;
  /** 事务里按顺序执行多条语句；失败时整体回滚。 */
  batch(queries: SqlQuery[]): Promise<SqlResult[]>;
}
