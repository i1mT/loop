// 对象存储接口：网关在 Workers 上用 R2 绑定，在 Node 上用 S3（含 MinIO 等兼容实现）。
// 业务代码只依赖这里的窄接口，不直接接触 R2Bucket 类型或 AWS SDK。
export interface ObjectMetadata {
  contentType?: string;
  customMetadata?: Record<string, string>;
}

/** bucket.get() 的返回值；Node 端把 S3 的响应体转成 Web ReadableStream */
export interface StoredObject {
  body: ReadableStream;
  size: number;
  httpMetadata?: ObjectMetadata;
  customMetadata?: Record<string, string>;
  httpEtag: string;
}

export interface ObjectHead {
  size: number;
  customMetadata?: Record<string, string>;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** 分片上传句柄：发布守护进程安装包时用，支持断点续传与大文件 */
export interface MultipartUpload {
  uploadId: string;
  uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<UploadedPart>;
  abort(): Promise<void>;
  complete(parts: UploadedPart[]): Promise<void>;
}

export interface ObjectStore {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: ObjectMetadata; customMetadata?: Record<string, string> },
  ): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectHead | null>;
  createMultipartUpload(key: string, options?: { httpMetadata?: ObjectMetadata; customMetadata?: Record<string, string> }): Promise<MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): Promise<MultipartUpload>;
}

/** 把 ArrayBuffer / Uint8Array / 字符串统一成字节，便于存储层处理 */
export function toBytes(value: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

/** 分片请求体可能是流（Web Request.body）；存储层需要完整字节时用它读完。 */
export async function toBytesAsync(value: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  return toBytes(value);
}
