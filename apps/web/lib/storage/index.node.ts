// 对象存储入口：Workers 从 R2 绑定构造，Node 从 S3 环境变量构造（见 lib/runtime/*）。
// 两条构建各自只打包各自的实现。
import type { ObjectStore } from "../object-store.ts";
import { rawEnv } from "#loop-runtime-env";
import { createS3Client, s3ObjectStore } from "./s3.node.ts";

export function objectStoreFromEnv(): ObjectStore {
  const env = rawEnv();
  const bucket = text(env.S3_BUCKET);
  if (!bucket) throw new Error("缺少 S3_BUCKET：Node 部署需要配置对象存储桶");
  const endpoint = text(env.S3_ENDPOINT) || undefined;
  const region = text(env.S3_REGION) || "us-east-1";
  const accessKeyId = text(env.S3_ACCESS_KEY_ID) || undefined;
  const secretAccessKey = text(env.S3_SECRET_ACCESS_KEY) || undefined;
  // 自建端点（MinIO 等）默认使用 path-style；AWS S3 与 R2 的 S3 端点用 virtual-hosted。
  const forcePathStyle = env.S3_FORCE_PATH_STYLE ? text(env.S3_FORCE_PATH_STYLE) !== "false" : !!endpoint;
  const client = createS3Client({ bucket, region, endpoint, accessKeyId, secretAccessKey, forcePathStyle });
  return s3ObjectStore(client, bucket, prefix(text(env.S3_PREFIX)));
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * 把 S3_PREFIX 归一化成“若干层目录 + 结尾斜杠”的形式：loop / loop/ / /loop/ 都得到 "loop/"。
 * 留空表示直接放在桶根，便于多个部署共用同一个桶或桶根已有其他内容。
 */
export function prefix(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}
