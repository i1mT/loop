// 对象存储（Workers）：把 R2 绑定包成窄接口，业务代码不再直接依赖 R2Bucket 类型。
import type { MultipartUpload, ObjectHead, ObjectStore, StoredObject, UploadedPart } from "../object-store.ts";
import { toBytes } from "../object-store.ts";

type R2BucketLike = {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    size: number;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
    httpEtag: string;
  } | null>;
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>;
  createMultipartUpload(key: string, options?: Record<string, unknown>): Promise<{ uploadId: string }>;
  resumeMultipartUpload(key: string, uploadId: string): {
    uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<UploadedPart>;
    abort(): Promise<void>;
    complete(parts: UploadedPart[]): Promise<unknown>;
  };
};

/** R2 在 Workers 里的绑定；Node 目标不会调用这里。 */
export function r2ObjectStore(bucket: R2BucketLike): ObjectStore {
  return {
    async put(key, value, options) {
      const bytes = toBytes(value);
      await bucket.put(key, bytes, options as Record<string, unknown> | undefined);
    },
    async get(key): Promise<StoredObject | null> {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        body: object.body,
        size: object.size,
        httpMetadata: { contentType: object.httpMetadata?.contentType },
        customMetadata: object.customMetadata,
        httpEtag: object.httpEtag,
      };
    },
    async head(key): Promise<ObjectHead | null> {
      const object = await bucket.head(key);
      if (!object) return null;
      return { size: object.size, customMetadata: object.customMetadata };
    },
    async createMultipartUpload(key, options): Promise<MultipartUpload> {
      const upload = await bucket.createMultipartUpload(key, options as Record<string, unknown> | undefined);
      return r2Multipart(bucket, key, upload.uploadId);
    },
    async resumeMultipartUpload(key, uploadId): Promise<MultipartUpload> {
      return r2Multipart(bucket, key, uploadId);
    },
  };
}

/** R2 的分片句柄是同步取到的；complete 返回 R2Object，这里统一成 void。 */
function r2Multipart(bucket: R2BucketLike, key: string, uploadId: string): MultipartUpload {
  const handle = bucket.resumeMultipartUpload(key, uploadId);
  return {
    uploadId,
    uploadPart: (partNumber, value) => handle.uploadPart(partNumber, value),
    abort: () => handle.abort(),
    complete: async (parts) => {
      await handle.complete(parts);
    },
  };
}
