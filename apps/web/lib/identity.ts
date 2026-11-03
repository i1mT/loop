export type Role = "admin" | "user";

export interface IdentityClaims {
  id: string;
  role: Role;
  name?: string;
  email?: string;
}

export type IdentityResult = { ok: true; claims: IdentityClaims } | { ok: false; reason: string };

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};
const b64urlToJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/** 验证接入应用后端签发的 HS256 JWT；任何异常都当作"无效"，调用方回落到普通用户 */
export async function verifyIdentity(token: string, secret: string): Promise<IdentityResult> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, reason: "格式不是 JWT" };
    const header = b64urlToJson(parts[0]);
    if (header.alg !== "HS256") return { ok: false, reason: "只支持 HS256" };
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return { ok: false, reason: "签名不匹配" };
    const p = b64urlToJson(parts[1]) as Record<string, unknown>;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof p.exp !== "number") return { ok: false, reason: "缺少 exp" };
    if (p.exp < nowSec) return { ok: false, reason: "令牌已过期" };
    if (typeof p.nbf === "number" && p.nbf > nowSec + 60) return { ok: false, reason: "令牌尚未生效" };
    if (p.sub === undefined || p.sub === null || p.sub === "") return { ok: false, reason: "缺少 sub" };
    return {
      ok: true,
      claims: {
        id: String(p.sub).slice(0, 120),
        role: p.role === "admin" ? "admin" : "user",
        name: typeof p.name === "string" ? p.name.slice(0, 80) : undefined,
        email: typeof p.email === "string" ? p.email.slice(0, 120) : undefined,
      },
    };
  } catch {
    return { ok: false, reason: "令牌无法解析" };
  }
}

/** 演示用：服务端替演示站签发令牌 */
export async function signIdentity(claims: IdentityClaims, secret: string, ttlSec = 3600): Promise<string> {
  const enc = (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ sub: claims.id, role: claims.role, name: claims.name, email: claims.email, exp: Math.floor(Date.now() / 1000) + ttlSec });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  const sigB64 = btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${head}.${body}.${sigB64}`;
}
