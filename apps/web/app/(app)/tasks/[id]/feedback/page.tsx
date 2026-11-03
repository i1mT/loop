"use client";
import { FeedbackList } from "@/components/task/feedback-view.tsx";
import { useTaskCtx } from "@/components/task/task-context.tsx";
import { ErrorState } from "@/components/ui/states.tsx";
import { useApi } from "@/lib/client-api.ts";
import type { FeedbackItem } from "@/lib/types.ts";

/** 反馈：任务的原始来源与完整内容（一个任务可以对应多条反馈） */
export default function TaskFeedback() {
  const { data } = useTaskCtx();
  const r = useApi<{ feedbacks: FeedbackItem[] }>(`/api/tasks/${data.task.id}`);
  if (r.error && !r.data) return <ErrorState message={r.error.message} onRetry={r.reload} />;
  return <FeedbackList feedbacks={r.data?.feedbacks ?? []} loading={r.loading} />;
}
