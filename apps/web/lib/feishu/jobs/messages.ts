import type { Db } from "../../pg.ts";
import { digest } from "../crypto.ts";
import type { Binding } from "../bindings.ts";
import { FeishuClient } from "../client.ts";
import { enqueueReply, type Job } from "./store.ts";
export interface MessageEvent {
  sender: {
    sender_id: { open_id?: string };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: { key: string; id: { open_id?: string } }[];
  };
}
export async function attachmentName(
  bindingId: string,
  messageId: string,
  extension: string,
): Promise<string> {
  return `img_${(await digest(bindingId + messageId)).slice(0, 16)}.${extension}`;
}
export async function processMessage(
  db: Db,
  binding: Binding,
  event: MessageEvent,
  job: Job,
  client: FeishuClient,
  origin: string,
): Promise<void> {
  const { message, sender } = event,
    openId = sender.sender_id?.open_id;
  if (sender.sender_type !== "user" || !openId) return;
  if (message.chat_type === "group" && !message.mentions?.length) return;
  let content: Record<string, unknown>;
  try {
    content = JSON.parse(message.content);
  } catch {
    throw new Error("消息内容无法读取");
  }
  let text = typeof content.text === "string" ? content.text.trim() : "";
  text = text.replace(/@_user_\d+/g, "").trim();
  const reply = (body: string) =>
    enqueueReply(
      db,
      binding.id,
      message.message_id,
      message.chat_id,
      body,
      `${job.id}:reply`,
    );
  if (/^绑定\s+[A-Za-z0-9-]+$/.test(text)) {
    if (message.chat_type !== "p2p") {
      await reply("请单聊机器人完成账号关联，避免在群中公开关联码。");
      return;
    }
    const hash = await digest(text.replace(/^绑定\s+/, ""));
    const linked = await db
      .prepare(
        `WITH consumed AS (UPDATE feishu_link_codes SET used_at=? WHERE code_hash=? AND binding_id=? AND expires_at>? AND used_at IS NULL RETURNING user_id) INSERT INTO feishu_identities(binding_id,open_id,user_id,name) SELECT ?,?,user_id,'' FROM consumed ON CONFLICT(binding_id,open_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING user_id`,
      )
      .bind(Date.now(), hash, binding.id, Date.now(), binding.id, openId)
      .first();
    await reply(
      linked
        ? "账号关联成功。现在可以向我发送创建任务的需求。"
        : "关联码无效或已过期，请在 Loop 的飞书设置中重新生成。",
    );
    return;
  }
  const identity = await db
    .prepare(
      `SELECT i.user_id FROM feishu_identities i JOIN "user" u ON u.id=i.user_id WHERE i.binding_id=? AND i.open_id=? AND (u.role='super' OR EXISTS(SELECT 1 FROM space_members m WHERE m.user_id=i.user_id AND m.space_id=?))`,
    )
    .bind(binding.id, openId, binding.space_id)
    .first<{ user_id: string }>();
  if (!identity) {
    await reply("请先登录 Loop，在当前空间的“飞书”设置中关联账号。");
    return;
  }
  const route =
    message.chat_type === "group"
      ? await db
          .prepare(
            "SELECT project_id FROM feishu_chat_routes WHERE binding_id=? AND chat_id=? AND enabled=1",
          )
          .bind(binding.id, message.chat_id)
          .first<{ project_id: string }>()
      : null;
  if (message.chat_type === "group" && !route) {
    await reply("这个群尚未接入项目，请联系空间管理员在飞书设置中配置。");
    return;
  }
  const projects = (
    await db
      .prepare(
        "SELECT id,name FROM projects WHERE space_id=? AND archived_at IS NULL ORDER BY name",
      )
      .bind(binding.space_id)
      .all<{ id: string; name: string }>()
  ).results;
  if (!projects.length) {
    await reply("当前空间还没有项目，请先在 Loop 创建项目。");
    return;
  }
  if (/^(帮助|help|菜单)$/i.test(text)) {
    await reply(
      "发送“创建任务：需求内容”即可创建任务，也可以发送“项目名称：创建任务：需求内容”。项目不明确时，我会请你选择。",
    );
    return;
  }
  let body = text;
  if (message.message_type === "image") {
    const imageKey =
      typeof content.image_key === "string" ? content.image_key : null;
    if (!imageKey) {
      await reply("没有读取到图片，请重新发送。");
      return;
    }
    const image = await client.image(message.message_id, imageKey);
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
    };
    const extension = extensions[image.type];
    if (!extension) {
      await reply("仅支持 PNG、JPEG、GIF、WebP 图片。");
      return;
    }
    const { getEnv } = await import("../../env.ts");
    const file = await attachmentName(
      binding.id,
      message.message_id,
      extension,
    );
    await getEnv().FILES.put(file, image.bytes, {
      httpMetadata: { contentType: image.type },
    });
    body = `创建任务：处理图片反馈\n\n![用户图片](${origin}/api/files/${file})`;
  } else if (message.message_type !== "text") {
    await reply(
      "目前支持文字和图片。请把文件中的需求整理为文字后发送，避免遗漏内容。",
    );
    return;
  }
  let projectId = route?.project_id ?? binding.default_project_id;
  const draft = await db
    .prepare(
      "SELECT body FROM feishu_drafts WHERE binding_id=? AND open_id=? AND chat_id=? AND expires_at>?",
    )
    .bind(binding.id, openId, message.chat_id, Date.now())
    .first<{ body: string }>();
  const selected = /^(?:选择\s*)?(\d+)$/.exec(text);
  if (draft && selected) {
    projectId = projects[Number(selected[1]) - 1]?.id ?? null;
    body = draft.body;
  } else {
    const explicit = projects.filter(
      (p) => text.startsWith(`${p.name}：`) || text.startsWith(`${p.name}:`),
    );
    if (explicit.length === 1) {
      projectId = explicit[0].id;
      body = text.slice(explicit[0].name.length + 1).trim();
    }
    if (
      message.message_type === "text" &&
      !/(?:创建|新建|提交)(?:一个|一条)?(?:任务|反馈)/.test(body)
    ) {
      await reply("如果需要执行这项需求，请发送“创建任务：需求内容”。");
      return;
    }
  }
  if (!projectId && projects.length === 1) projectId = projects[0].id;
  if (!projectId || !projects.some((p) => p.id === projectId)) {
    await db
      .prepare(
        "INSERT INTO feishu_drafts(binding_id,open_id,chat_id,body,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(binding_id,open_id,chat_id) DO UPDATE SET body=EXCLUDED.body,expires_at=EXCLUDED.expires_at",
      )
      .bind(binding.id, openId, message.chat_id, body, Date.now() + 15 * 60000)
      .run();
    await reply(
      `请选择这项需求所属的项目，回复对应序号：\n${projects.map((p, i) => `${i + 1}. ${p.name}`).join("\n")}`,
    );
    return;
  }
  const taskBody = body
    .replace(
      /^.*?(?:创建|新建|提交)(?:一个|一条)?(?:任务|反馈)\s*[:：]?\s*/,
      "",
    )
    .trim();
  if (!taskBody) {
    await reply("请在“创建任务”后面填写具体需求。");
    return;
  }
  const { submitFeedback } = await import("../../batch.ts");
  const result = await submitFeedback({
    projectId,
    title: taskBody.split("\n")[0].slice(0, 200),
    body: taskBody,
    source: "feishu",
    sourceRef: {
      bindingId: binding.id,
      messageId: message.message_id,
      chatId: message.chat_id,
      userId: identity.user_id,
    },
    idempotencyKey: `feishu:${binding.id}:${message.message_id}`,
  });
  await db
    .prepare(
      "INSERT INTO feedback_subscriptions(feedback_id,binding_id,chat_id,message_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
    )
    .bind(result.feedback.id, binding.id, message.chat_id, message.message_id)
    .run();
  await db
    .prepare(
      "DELETE FROM feishu_drafts WHERE binding_id=? AND open_id=? AND chat_id=?",
    )
    .bind(binding.id, openId, message.chat_id)
    .run();
  const project = projects.find((p) => p.id === projectId)!;
  await reply(
    result.task
      ? `已经创建任务：${result.task.title}\n项目：${project.name}\n${origin}/tasks/${result.task.id}`
      : `已经收到需求，正在等待合并（${result.pooled?.count ?? 1}/${result.pooled?.size ?? 3}）。\n项目：${project.name}\n反馈编号：${result.feedback.id}`,
  );
}
