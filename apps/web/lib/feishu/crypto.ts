const encoder = new TextEncoder();
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const digest = async (s: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export function equal(a: string, b: string): boolean {
  const left = encoder.encode(a),
    right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}
async function masterKey(secret: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = bytes(secret);
  } catch {
    throw new Error("飞书凭证加密密钥未配置");
  }
  if (raw.length !== 32) throw new Error("飞书凭证加密密钥未配置");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(
  value: unknown,
  secret: string,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await masterKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function unseal<T>(
  value: string,
  secret: string,
  context: string,
): Promise<T> {
  const [version, iv, cipher] = value.split(".");
  if (version !== "v1" || !iv || !cipher) throw new Error("飞书凭证格式不正确");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(iv), additionalData: encoder.encode(context) },
    await masterKey(secret),
    bytes(cipher),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
export interface EventEnvelope {
  type?: string;
  token?: string;
  challenge?: string;
  header?: {
    token?: string;
    app_id?: string;
    tenant_key?: string;
    event_type?: string;
    event_id?: string;
  };
  event?: Record<string, unknown>;
}
export async function decodeEvent(
  raw: string,
  headers: Headers,
  encryptKey: string,
  verificationToken: string,
  timestamp = Date.now(),
): Promise<EventEnvelope> {
  const stamp = headers.get("x-lark-request-timestamp") ?? "",
    nonce = headers.get("x-lark-request-nonce") ?? "",
    signature = headers.get("x-lark-signature") ?? "";
  if (
    !stamp ||
    !nonce ||
    !signature ||
    !/^\d+$/.test(stamp) ||
    Math.abs(timestamp - Number(stamp) * 1000) > 300000
  )
    throw new Error("回调签名无效或已过期");
  if (
    !equal(
      await digest(stamp + nonce + encryptKey + raw),
      signature.toLowerCase(),
    )
  )
    throw new Error("回调签名无效");
  let envelope = JSON.parse(raw) as EventEnvelope & { encrypt?: string };
  if (envelope.encrypt) {
    const encrypted = bytes(envelope.encrypt);
    const key = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", encoder.encode(encryptKey)),
      "AES-CBC",
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: encrypted.slice(0, 16) },
      key,
      encrypted.slice(16),
    );
    envelope = JSON.parse(new TextDecoder().decode(plaintext));
  }
  if (!equal(envelope.header?.token ?? envelope.token ?? "", verificationToken))
    throw new Error("回调验证令牌无效");
  return envelope;
}
