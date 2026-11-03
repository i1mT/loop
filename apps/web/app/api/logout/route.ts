import { json } from "@/lib/http.ts";
import { isLocalMode, withAuth } from "@/lib/auth-server.ts";
import { LOCAL_COOKIE } from "@/lib/local-session.ts";

export async function POST(req: Request) {
  if (isLocalMode()) return json({ ok: true }, 200, { "set-cookie": `${LOCAL_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
  const res = await withAuth(new URL(req.url).origin, (auth) => auth.api.signOut({ headers: req.headers, asResponse: true }).catch(() => null));
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const c of res?.headers.getSetCookie() ?? []) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
