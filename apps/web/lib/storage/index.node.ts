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
  return s3ObjectStore(client, bucket);
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
