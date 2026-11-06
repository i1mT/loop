import { getDb } from "@/lib/db.ts";
import { getEnv } from "@/lib/env.ts";
import { getBindingById } from "@/lib/feishu/bindings.ts";
import { pinEventTenant } from "@/lib/feishu/events.ts";
import { decodeEvent, unseal } from "@/lib/feishu/crypto.ts";
import { enqueue } from "@/lib/feishu/jobs/store.ts";
import { fail, json } from "@/lib/http.ts";
import type { FeishuSecrets } from "@/lib/feishu/bindings.ts";
import type { MessageEvent } from "@/lib/feishu/jobs/messages.ts";
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = await getDb();
  const binding = await getBindingById(db, id);
  if (!binding) return fail(404, "机器人未配置");
  if (Number(req.headers.get("content-length") ?? 0) > 100000)
    return fail(413, "消息过大");
  const raw = await req.text();
  if (raw.length > 100000) return fail(413, "消息过大");
  // 回调要求快速返回，状态记录用 waitUntil 异步写，失败不影响本次响应。
  const { waitUntil } = await import("cloudflare:workers");
  try {
    const secrets = await unseal<FeishuSecrets>(
      binding.secrets,
      getEnv().FEISHU_ENCRYPTION_KEY ?? "",
      id,
    );
    const event = await decodeEvent(
      raw,
      req.headers,
      secrets.encryptKey,
      secrets.verificationToken,
    );
    if (event.header?.app_id && event.header.app_id !== binding.app_id)
      return fail(403, "应用不匹配");
    if (event.type === "url_verification" && event.challenge) {
      waitUntil(
        db
          .prepare(
            `UPDATE space_feishu_bindings SET callback_verified_at=? WHERE id=?`,
          )
          .bind(Date.now(), id)
          .run()
          .catch(() => {
            console.error("feishu_callback_status_failed");
          }),
      );
      return json({ challenge: event.challenge });
    }
    if (!binding.enabled) return json({ ok: true });
    if (event.header?.event_type !== "im.message.receive_v1")
      return json({ ok: true });
    const message = event.event as unknown as MessageEvent;
    if (
      !message?.message?.message_id ||
      !message.message.chat_id ||
      message.sender?.sender_type !== "user"
    )
      return json({ ok: true });
    // 企业归属只从已验签的消息记录；不匹配时记下对方企业，设置页据此提示并允许负责人重置。
    if (!(await pinEventTenant(db, binding, event))) {
      waitUntil(
        db
          .prepare(
            `UPDATE space_feishu_bindings SET tenant_mismatch_at=?,tenant_mismatch_key=? WHERE id=?`,
          )
          .bind(Date.now(), event.header?.tenant_key ?? "", id)
          .run()
          .catch(() => {
            console.error("feishu_tenant_mismatch_record_failed");
          }),
      );
      return fail(403, "应用或企业不匹配");
    }
    if (!binding.callback_verified_at)
      await db
        .prepare(
          `UPDATE space_feishu_bindings SET callback_verified_at=? WHERE id=?`,
        )
        .bind(Date.now(), id)
        .run();
    await enqueue(
      db,
      id,
      "inbox",
      `message:${id}:${message.message.message_id}`,
      message,
    );
    // 机器人不回复时先看这个时间：区分“消息没送到”和“送到了但处理失败”。
    waitUntil(
      db
        .prepare(
          `UPDATE space_feishu_bindings SET last_event_at=?,tenant_mismatch_at=NULL,tenant_mismatch_key=NULL WHERE id=?`,
        )
        .bind(Date.now(), id)
        .run()
        .catch(() => {
          console.error("feishu_last_event_record_failed");
        }),
    );
    return json({ ok: true });
  } catch {
    return fail(403, "事件验证失败");
  }
}
