// 对象存储（Node）：S3 API。用 endpoint + forcePathStyle 兼容 AWS S3、MinIO、Cloudflare R2 的 S3 端点。
// 只依赖 @aws-sdk/client-s3；分片上传走 S3 原生 multipart，与 Workers 上的 R2 语义保持一致。
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type { MultipartUpload, ObjectHead, ObjectStore, StoredObject, UploadedPart } from "../object-store.ts";
import { toBytes, toBytesAsync } from "../object-store.ts";

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

export function createS3Client(options: S3Options): S3Client {
  return new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
    // 只有显式提供静态凭证时才用；否则交给 SDK 的默认凭证链（实例角色等）。
    credentials:
      options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined,
    // 自建存储常没有完全一致的校验和实现，关闭校验和以提升兼容性。
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function bodyToStream(body: unknown): ReadableStream {
  // SDK 在 Node 中返回的是 Readable（Node 流）；转成 Web ReadableStream 供 Response 使用。
  if (body && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function") {
    return (body as { transformToWebStream: () => ReadableStream }).transformToWebStream();
  }
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

export function s3ObjectStore(client: S3Client, bucket: string, prefix = ""): ObjectStore {
  // 前缀只加一次：所有读写与分片上传都经 objectKey，桶内布局与 R2 目标保持一致。
  const objectKey = (key: string): string => `${prefix}${key}`;
  return {
    async put(key, value, options): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(key),
          Body: toBytes(value),
          ContentType: options?.httpMetadata?.contentType,
          Metadata: options?.customMetadata,
        }),
      );
    },

    async get(key): Promise<StoredObject | null> {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        if (!result.Body) return null;
        return {
          body: bodyToStream(result.Body),
          size: Number(result.ContentLength ?? 0),
          httpMetadata: { contentType: result.ContentType },
          customMetadata: result.Metadata,
          httpEtag: (result.ETag ?? "").replace(/^"|"$/g, ""),
        };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },

    async head(key): Promise<ObjectHead | null> {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        return { size: Number(result.ContentLength ?? 0), customMetadata: result.Metadata };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },

    async createMultipartUpload(key, options): Promise<MultipartUpload> {
      const created = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey(key),
          ContentType: options?.httpMetadata?.contentType,
          Metadata: options?.customMetadata,
        }),
      );
      if (!created.UploadId) throw new Error("S3 没有返回 uploadId");
      return multipartHandle(client, bucket, objectKey(key), created.UploadId);
    },

    async resumeMultipartUpload(key, uploadId): Promise<MultipartUpload> {
      return multipartHandle(client, bucket, objectKey(key), uploadId);
    },
  };
}

function multipartHandle(client: S3Client, bucket: string, key: string, uploadId: string): MultipartUpload {
  return {
    uploadId,
    async uploadPart(partNumber: number, value): Promise<UploadedPart> {
      const result = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: await toBytesAsync(value),
        }),
      );
      return { partNumber, etag: (result.ETag ?? "").replace(/^"|"$/g, "") };
    },
    async abort(): Promise<void> {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    },
    async complete(parts: UploadedPart[]): Promise<void> {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
    },
  };
}

function isMissingObject(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
