// 本地模式的会话 cookie：本地网关没有数据库，登录时向云端验证邮箱与密码，
// 通过后写入一个用本机密钥签名的 cookie（值 = base64url(邮箱).HMAC）。
const enc = new TextEncoder();
export const LOCAL_COOKIE = "loop_local_session";

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

async function mac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`loop-local-v1:${msg}`))));
}

export async function signLocalSession(secret: string, email: string): Promise<string> {
  const payload = b64(enc.encode(email));
  return `${payload}.${await mac(secret, payload)}`;
}

/** 返回邮箱；签名不对返回 null */
export async function verifyLocalSession(secret: string, value: string | null | undefined): Promise<string | null> {
  if (!value || !secret) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || sig !== (await mac(secret, payload))) return null;
  try {
    return unb64(payload);
  } catch {
    return null;
  }
}
