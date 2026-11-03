import { getDb } from "@/lib/db.ts";
import { getEnv } from "@/lib/env.ts";
import { getBindingById, getBindingSecrets } from "@/lib/feishu/bindings.ts";
import { decodeEvent } from "@/lib/feishu/crypto.ts";
import { enqueue } from "@/lib/feishu/jobs/store.ts";
import { fail, json } from "@/lib/http.ts";
import type { MessageEvent } from "@/lib/feishu/jobs/messages.ts";
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = await getDb();
  const binding = await getBindingById(db, id);
  if (!binding?.enabled) return fail(404, "机器人未启用");
  if (Number(req.headers.get("content-length") ?? 0) > 100000)
    return fail(413, "消息过大");
  const raw = await req.text();
  if (raw.length > 100000) return fail(413, "消息过大");
  try {
    const secrets = await getBindingSecrets(
      db,
      id,
      getEnv().FEISHU_ENCRYPTION_KEY ?? "",
    );
    const event = await decodeEvent(
      raw,
      req.headers,
      secrets.encryptKey,
      secrets.verificationToken,
    );
    if (event.header?.app_id && event.header.app_id !== binding.app_id)
      return fail(403, "应用不匹配");
    if (
      event.header?.tenant_key &&
      event.header.tenant_key !== binding.tenant_key
    )
      return fail(403, "企业不匹配");
    if (event.type === "url_verification" && event.challenge)
      return json({ challenge: event.challenge });
    if (event.header?.event_type !== "im.message.receive_v1")
      return json({ ok: true });
    const message = event.event as unknown as MessageEvent;
    if (
      !message?.message?.message_id ||
      !message.message.chat_id ||
      message.sender?.sender_type !== "user"
    )
      return json({ ok: true });
    if (
      message.sender.tenant_key &&
      message.sender.tenant_key !== binding.tenant_key
    )
      return fail(403, "企业不匹配");
    await enqueue(
      db,
      id,
      "inbox",
      `message:${id}:${message.message.message_id}`,
      message,
    );
    return json({ ok: true });
  } catch {
    return fail(403, "事件验证失败");
  }
}
