"use client";
import { Conversation } from "@/components/task/conversation.tsx";
import { useTaskCtx } from "@/components/task/task-context.tsx";

/** 会话：与智能体的对话与待处理的请求 */
export default function TaskChat() {
  const { data, progress, reload, hasMore, loadingOlder, loadOlder } = useTaskCtx();
  const { task } = data;
  return <Conversation key={task.id} task={task} events={data.events} pending={data.pending} activity={progress.activity} reload={reload} hasMore={hasMore} loadingOlder={loadingOlder} loadOlder={loadOlder} />;
}
