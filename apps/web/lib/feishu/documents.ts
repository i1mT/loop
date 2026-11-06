import { getDb } from "../db.ts";
import type { Db } from "../pg.ts";
import { FeishuClient, FeishuApiError } from "./client.ts";
import { getBindingSecrets, wikiToken, type Binding } from "./bindings.ts";
import { digest } from "./crypto.ts";
interface DocumentRow {
  task_id: string;
  binding_id: string;
  wiki_url: string;
  document_id: string | null;
  node_token: string | null;
  title: string;
  creating: number;
  locked_until: number;
  lock_token: string | null;
}
export async function syncTaskDocument(
  input: {
    taskId: string;
    round: number;
    title: string;
    markdown: string;
    kind: "plan" | "result" | "publish";
    revision?: number;
  },
  deps: { db?: Db; key?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ url: string }> {
  const db = deps.db ?? (await getDb()),
    key =
      deps.key ??
      (await import("../env.ts")).getEnv().FEISHU_ENCRYPTION_KEY ??
      "";
  const existing = await db
    .prepare("SELECT * FROM task_documents WHERE task_id=?")
    .bind(input.taskId)
    .first<DocumentRow>();
  const binding = existing
    ? await db
        .prepare("SELECT * FROM space_feishu_bindings WHERE id=?")
        .bind(existing.binding_id)
        .first<Binding>()
    : await db
        .prepare(
          "SELECT b.*,r.wiki_url FROM space_feishu_bindings b JOIN task_plan_rounds r ON r.binding_id=b.id WHERE r.task_id=? AND r.round=?",
        )
        .bind(input.taskId, input.round)
        .first<Binding>();
  if (!binding) throw new Error("空间尚未启用飞书机器人");
  const title = input.title.trim().slice(0, 180);
  if (!title) throw new Error("文档标题不能为空");
  await db
    .prepare(
      "INSERT INTO task_documents(task_id,binding_id,wiki_url,title,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(task_id) DO NOTHING",
    )
    .bind(input.taskId, binding.id, binding.wiki_url, title, Date.now())
    .run();
  const token = crypto.randomUUID(),
    time = Date.now();
  const doc = await db
    .prepare(
      "UPDATE task_documents SET locked_until=?,lock_token=? WHERE task_id=? AND locked_until<? RETURNING *",
    )
    .bind(time + 120000, token, input.taskId, time)
    .first<DocumentRow>();
  if (!doc) throw new Error("技术方案正在同步，请稍后重试");
  try {
    const client = new FeishuClient(
      await getBindingSecrets(db, binding.id, key),
      deps.fetchImpl,
    );
    let documentId = doc.document_id,
      nodeToken = doc.node_token;
    if (!documentId) {
      const parent = await client.resolveWiki(wikiToken(doc.wiki_url));
      const matches = (
        await client.listWiki(parent.space_id, parent.node_token)
      ).filter((n) => n.title === doc.title);
      if (matches.length > 1)
        throw new Error("发现多个同名任务文档，请核对后重试");
      let node = matches[0];
      if (!node) {
        // creating=1 且无法对账时不重复创建，避免 API 成功但响应丢失后产生多个文档。
        if (doc.creating)
          throw new Error("文档创建结果尚未确认，请检查知识库目录后重试");
        await db
          .prepare(
            "UPDATE task_documents SET creating=1 WHERE task_id=? AND lock_token=?",
          )
          .bind(input.taskId, token)
          .run();
        try {
          node = await client.createWikiDocument(
            parent.space_id,
            parent.node_token,
            doc.title,
          );
        } catch (error) {
          // 飞书明确拒绝了这次创建（返回业务错误码）说明文档没建出来，可以安全重试；
          // 只有网络中断这类结果未知的失败才保留 creating=1，避免重复建文档。
          if (error instanceof FeishuApiError)
            await db
              .prepare(
                "UPDATE task_documents SET creating=0 WHERE task_id=? AND lock_token=?",
              )
              .bind(input.taskId, token)
              .run();
          throw error;
        }
      }
      documentId = node.obj_token;
      nodeToken = node.node_token;
      await db
        .prepare(
          "UPDATE task_documents SET document_id=?,node_token=?,creating=0,updated_at=? WHERE task_id=? AND lock_token=?",
        )
        .bind(documentId, nodeToken, Date.now(), input.taskId, token)
        .run();
    }
    const op = await digest(
      `${input.taskId}:${input.round}:${input.kind}:${input.revision ?? 0}:${input.markdown}`,
    );
    await db
      .prepare(
        "INSERT INTO feishu_document_parts(operation_key,task_id) VALUES(?,?) ON CONFLICT DO NOTHING",
      )
      .bind(op, input.taskId)
      .run();
    const part = await db
      .prepare(
        "SELECT completed FROM feishu_document_parts WHERE operation_key=?",
      )
      .bind(op)
      .first<{ completed: number }>();
    if (!part?.completed) {
      const heading =
        input.kind === "plan"
          ? "技术方案"
          : input.kind === "result"
            ? "实际改动与验证"
            : "发布结果";
      // 技术方案正文原样写入，不再加“第 N 轮 · 技术方案”这样的前缀；
      // 同文档后续追加的实际改动和发布记录仍保留轮次标题，便于回溯。
      const content =
        input.kind === "plan"
          ? input.markdown
          : `第 ${input.round} 轮 · ${heading}\n\n${input.markdown}`;
      const blockIds = await client.appendMarkdown(
        documentId,
        content,
        op,
        async () => {
          const lock = await db
            .prepare(
              "UPDATE task_documents SET locked_until=? WHERE task_id=? AND lock_token=? AND locked_until>? RETURNING task_id",
            )
            .bind(Date.now() + 120000, input.taskId, token, Date.now())
            .first();
          if (!lock) throw new Error("文档同步租约已经失效，请重试");
        },
      );
      await db
        .prepare(
          "UPDATE feishu_document_parts SET completed=1,block_ids=? WHERE operation_key=?",
        )
        .bind(JSON.stringify(blockIds), op)
        .run();
    }
    const base = new URL(doc.wiki_url);
    return { url: `${base.origin}/wiki/${nodeToken}` };
  } finally {
    await db
      .prepare(
        "UPDATE task_documents SET locked_until=0,lock_token=NULL WHERE task_id=? AND lock_token=?",
      )
      .bind(input.taskId, token)
      .run();
  }
}
