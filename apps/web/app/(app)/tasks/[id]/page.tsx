"use client";
import { Conversation } from "@/components/task/conversation.tsx";
import { useTaskCtx } from "@/components/task/task-context.tsx";
import { canIterate, canReply } from "@/lib/status.ts";

/** 会话：与智能体的对话与待处理的请求 */
export default function TaskChat() {
  const { data, reload } = useTaskCtx();
  const { task } = data;
  return <Conversation taskId={task.id} events={data.events} pending={data.pending} waiting={data.session?.state === "needs_you"} reload={reload} readOnly={!canReply(task.stage) && !canIterate(task.stage)} iterate={canIterate(task.stage)} />;
}
