import type { Db } from "../../pg.ts";
import { enqueue, enqueueReply } from "./store.ts";

interface NotificationTask {
  id: string;
  title: string;
  round: number;
  projectName: string;
  spaceId: string;
  prUrl: string | null;
  error: string | null;
  documentUrl: string | null;
}

interface Recipient {
  binding_id: string;
  chat_id: string;
  message_id: string;
  chat_type: string;
}

/**
 * 不同阶段使用不同的标题、说明、颜色和操作按钮。等待人工处理的阶段统一打上
 * 「待人工处理」，让人一眼看出这条消息需要自己动手。
 */
const STAGE_NOTICES: Record<
  string,
  { tag: string; heading: string; summary: string; template: string }
> = {
  received: {
    tag: "已收到",
    heading: "任务已创建",
    summary: "已经收到这项需求，正在安排执行。",
    template: "blue",
  },
  batched: {
    tag: "等待合并",
    heading: "需求已进入合并池",
    summary: "改动较小，会和其他反馈合并成一个任务后处理。",
    template: "grey",
  },
  held: {
    tag: "待确认",
    heading: "任务等待确认",
    summary: "任务需要管理员确认后才会开始执行。",
    template: "orange",
  },
  queued: {
    tag: "排队中",
    heading: "等待机器领取",
    summary: "任务已进入队列，空闲的机器会尽快领取。",
    template: "blue",
  },
  running: {
    tag: "处理中",
    heading: "智能体正在执行",
    summary: "正在阅读代码并处理这项任务，有新的进展会继续通知。",
    template: "blue",
  },
  needs_you: {
    tag: "待人工处理",
    heading: "智能体需要你",
    summary: "智能体在等待你的决定或回复，任务已暂停。",
    template: "orange",
  },
  plan_reviewing: {
    tag: "待人工处理",
    heading: "技术方案待审核",
    summary: "技术方案已经生成，审核通过后才会开始实现。",
    template: "orange",
  },
  plan_approved: {
    tag: "方案已通过",
    heading: "开始按方案实现",
    summary: "技术方案已通过审核，智能体正在按方案实现。",
    template: "blue",
  },
  reviewing: {
    tag: "待人工处理",
    heading: "改动待审核",
    summary: "改动已经提交并创建 PR，请审核后再合并发布。",
    template: "orange",
  },
  approved: {
    tag: "已通过",
    heading: "等待发布",
    summary: "改动已通过审核，准备合并并发布。",
    template: "blue",
  },
  publishing: {
    tag: "发布中",
    heading: "正在发布",
    summary: "PR 已合并，智能体正在执行发布。",
    template: "blue",
  },
  publish_review: {
    tag: "待人工处理",
    heading: "发布结果待确认",
    summary: "智能体没有明确报告发布成败，请确认最终结果。",
    template: "orange",
  },
  published: {
    tag: "已完成",
    heading: "任务发布成功",
    summary: "改动已合并并完成发布。",
    template: "green",
  },
  rejected: {
    tag: "已驳回",
    heading: "任务已驳回",
    summary: "任务不会再继续处理。",
    template: "grey",
  },
  failed: {
    tag: "执行失败",
    heading: "任务执行失败",
    summary: "请查看失败原因，必要时恢复任务或重新开始。",
    template: "red",
  },
  cancelled: {
    tag: "已取消",
    heading: "任务已取消",
    summary: "任务已停止，不会再继续处理。",
    template: "grey",
  },
};

function truncate(text: string, max: number): string {
  const value = text.trim();
  return value.length > max ? `${value.slice(0, max)}……` : value;
}


function action(
  text: string,
  url: string,
  type: "default" | "primary" = "default",
) {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    url,
    type,
  };
}

function baseCard(
  template: string,
  title: string,
  lines: string[],
  buttons: ReturnType<typeof action>[],
) {
  return {
    config: { wide_screen_mode: true },
    header: {
      template,
      title: { tag: "plain_text", content: title },
    },
    elements: [
      ...lines.map((content) => ({
        tag: "div",
        text: { tag: "lark_md", content },
      })),
      { tag: "hr" },
      { tag: "action", actions: buttons },
    ],
  };
}

function stageCard(task: NotificationTask, stage: string, origin: string, detail?:string|null) {
  const notice = STAGE_NOTICES[stage];
  const taskUrl = `${origin}/tasks/${task.id}`;
  const lines = [
    `**${task.title}**`,
    notice.summary,
    `项目：${task.projectName}`,
  ];
  if(detail?.trim())lines.push(`**备注与反馈**：${truncate(detail,6000)}`);
  if (!detail && task.error && ["failed", "publish_review"].includes(stage))
    lines.push(`**原因**：${truncate(task.error, 500)}`);
  const buttons = [action("查看任务", taskUrl, "primary")];
  if (task.prUrl && ["reviewing", "approved", "publishing"].includes(stage))
    buttons.unshift(action("查看 PR", task.prUrl));
  return baseCard(
    notice.template,
    `【${notice.tag}】${notice.heading}`,
    lines,
    buttons,
  );
}

function planCard(
  task: NotificationTask,
  input: {
    title: string;
    round: number;
    documentUrl: string;
    reviewRequired: boolean;
  },
  origin: string,
) {
  const taskUrl = `${origin}/tasks/${task.id}`;
  const buttons = [
    action("查看技术方案", input.documentUrl, "primary"),
    action("查看任务", taskUrl),
  ];
  const note = input.reviewRequired
    ? "方案已保存到飞书文档。请审核方案，通过后智能体才会开始实现。"
    : "方案已保存到飞书文档，智能体已经开始按方案实现。";
  return {
    config: { wide_screen_mode: true },
    header: {
      template: input.reviewRequired ? "orange" : "blue",
      title: {
        tag: "plain_text",
        content: input.reviewRequired
          ? `【待人工处理】技术方案待审核：${truncate(input.title, 80)}`
          : `【技术方案已生成】${truncate(input.title, 80)}`,
      },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**任务**：${task.title}\n**项目**：${task.projectName}`,
        },
      },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: note } },
      { tag: "action", actions: buttons },
    ],
  };
}

function fallbackText(title: string, task: NotificationTask, extra?: string) {
  return `${title}\n任务：${task.title}\n项目：${task.projectName}${extra ? `\n${extra}` : ""}`;
}

async function loadTask(
  db: Db,
  taskId: string,
): Promise<NotificationTask | null> {
  return db
    .prepare(
      `SELECT t.id,t.title,t.round,t.error,t.pr_url AS "prUrl",p.name AS "projectName",p.space_id AS "spaceId",
      (SELECT r.document_url FROM task_plan_rounds r WHERE r.task_id=t.id AND r.round=t.round) AS "documentUrl"
    FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?`,
    )
    .bind(taskId)
    .first<NotificationTask>();
}

async function recipients(
  db: Db,
  taskId: string,
  spaceId: string,
  snapshot?: { bindingId: string; notificationChatId: string | null },
): Promise<Recipient[]> {
  return (
    await db
      .prepare(
        `SELECT DISTINCT s.binding_id,s.chat_id,s.message_id,s.chat_type FROM feedback_subscriptions s JOIN feedbacks f ON f.id=s.feedback_id JOIN space_feishu_bindings b ON b.id=s.binding_id WHERE f.task_id=? AND b.space_id=? AND b.enabled=1${snapshot ? " AND b.id=?" : ""} ORDER BY s.binding_id,s.chat_id,s.message_id,s.chat_type`,
      )
      .bind(taskId, spaceId, ...(snapshot ? [snapshot.bindingId] : []))
      .all<Recipient>()
  ).results;
}

async function fallbackBinding(
  db: Db,
  spaceId: string,
  snapshot?: { bindingId: string; notificationChatId: string | null },
) {
  if (snapshot) {
    return snapshot.notificationChatId
      ? { id: snapshot.bindingId, notification_chat_id: snapshot.notificationChatId }
      : null;
  }
  return db
    .prepare(
      "SELECT id,notification_chat_id FROM space_feishu_bindings WHERE space_id=? AND enabled=1 AND notification_chat_id IS NOT NULL",
    )
    .bind(spaceId)
    .first<{ id: string; notification_chat_id: string }>();
}

async function deliver(
  db: Db,
  task: NotificationTask,
  taskId: string,
  key: string,
  card: unknown,
  text: string,
  snapshot?: { bindingId: string; notificationChatId: string | null },
): Promise<boolean> {
  // 合并任务需要等待每条飞书反馈登记来源，避免只向先登记的部分消息发送进度。
  const pending=await db.prepare(`SELECT f.id FROM feedbacks f WHERE f.task_id=? AND f.source='feishu'
    AND NOT EXISTS(SELECT 1 FROM feedback_subscriptions s WHERE s.feedback_id=f.id) LIMIT 1`).bind(taskId).first();
  if(pending)return false;
  const list = await recipients(db, taskId, task.spaceId, snapshot);
  for (const r of list)
    await enqueueReply(
      db,
      r.binding_id,
      r.message_id,
      r.chat_id,
      text,
      `${key}:${r.binding_id}:${r.chat_id}:${r.message_id}`,
      { taskId, round: task.round, card,replyInThread:r.chat_type!=="p2p" },
    );
  if (!list.length) {
    // 来源订阅已经齐全但当前绑定没有可投递的会话时，不改发到其他群。
    const source=await db.prepare(`SELECT id FROM feedbacks WHERE task_id=? AND source='feishu' LIMIT 1`).bind(taskId).first();
    if(source)return true;
    const b = await fallbackBinding(db, task.spaceId, snapshot);
    if (b)
      await enqueue(db, b.id, "send", `${key}:${b.id}:${b.notification_chat_id}`, {
        chatId: b.notification_chat_id,
        text,
        card,
        taskId,
        round: task.round,
      });
  }
  return true;
}

export async function enqueueTaskNotification(
  db: Db,
  taskId: string,
  transitionKey: string,
  stage: string,
  origin: string,
  snapshot?: { bindingId: string; notificationChatId: string | null },
  detail?: string | null,
): Promise<boolean> {
  const notice = STAGE_NOTICES[stage];
  if (!notice) return true;
  const task = await loadTask(db, taskId);
  if (!task) return true;
  return deliver(
    db,
    task,
    taskId,
    `task:${taskId}:${transitionKey}`,
    stageCard(task, stage, origin, detail),
    fallbackText(`【${notice.tag}】${notice.heading}\n${notice.summary}`, task, detail ? `备注与反馈：${truncate(detail,6000)}`:undefined),
    snapshot,
  );
}

/** 技术方案保存到飞书后，只发送简短说明与文档链接。 */
export async function enqueuePlanNotification(
  db: Db,
  input: {
    taskId: string;
    round: number;
    revision: number;
    title: string;
    documentUrl: string;
    reviewRequired: boolean;
  },
  origin: string,
): Promise<void> {
  const task = await loadTask(db, input.taskId);
  if (!task) return;
  const title = input.title || task.title;
  const tag = input.reviewRequired
    ? "待人工处理"
    : "技术方案已生成";
  const body = input.reviewRequired
    ? `【${tag}】技术方案待审核：${title}\n任务：${task.title}\n项目：${task.projectName}\n${input.documentUrl}`
    : `【${tag}】${title}\n任务：${task.title}\n项目：${task.projectName}\n${input.documentUrl}`;
  const delivered=await deliver(
    db,
    task,
    input.taskId,
    `task:${input.taskId}:plan:${input.round}:${input.revision}`,
    planCard(
      task,
      {
        title,
        round: input.round,
        documentUrl: input.documentUrl,
        reviewRequired: input.reviewRequired,
      },
      origin,
    ),
    body,
  );
  if(!delivered)throw new Error("反馈来源消息尚未登记，稍后重试技术方案通知");
}

export async function scanStageEvents(db: Db, origin: string): Promise<number> {
  const events = (
    await db
      .prepare(
        "SELECT id,task_id,round,stage,binding_id,notification_chat_id,detail FROM feishu_stage_events WHERE queued=0 ORDER BY id LIMIT 100",
      )
      .all<{
        id: number;
        task_id: string;
        round: number;
        stage: string;
        binding_id: string | null;
        notification_chat_id: string | null;
        detail: string | null;
      }>()
  ).results;
  for (const event of events) {
    const task = await db
      .prepare("SELECT round FROM tasks WHERE id=?")
      .bind(event.task_id)
      .first<{ round: number }>();
    // 方案进入审核时会单独发送包含文档链接的卡片，这里不重复发一条状态通知。
    if (
      task?.round === event.round &&
      event.binding_id &&
      STAGE_NOTICES[event.stage] &&
      event.stage !== "plan_reviewing"
    ) {
      const delivered=await enqueueTaskNotification(
        db,
        event.task_id,
        `event:${event.id}`,
        event.stage,
        origin,
        {
          bindingId: event.binding_id,
          notificationChatId: event.notification_chat_id,
        },
        event.detail,
      );
      if(!delivered)continue;
    }
    await db
      .prepare("UPDATE feishu_stage_events SET queued=1 WHERE id=?")
      .bind(event.id)
      .run();
  }
  return events.length;
}
