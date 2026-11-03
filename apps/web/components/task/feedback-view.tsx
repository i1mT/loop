"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Chip } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/states.tsx";
import { clockTime } from "@/lib/format.ts";
import { SCALE_LABEL } from "@/lib/status.ts";
import type { FeedbackItem } from "@/lib/types.ts";

const SOURCE_LABEL: Record<string, string> = { sdk: "网站 SDK", api: "API", manual: "手动创建" };

interface SourceRef {
  reporter?: { name?: string; email?: string; id?: string; verified?: boolean } | null;
  role?: string;
  page?: string | null;
  contact?: string | null;
  identityNote?: string | null;
}

function parseRef(raw: string | null): SourceRef {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SourceRef;
  } catch {
    return {};
  }
}

/** 一条原始反馈：来源、提交者、页面、规模，以及提交时的完整正文（截图等附件已作为图片链接写在正文里；标题只是摘要） */
function FeedbackBlock({ f, index, total }: { f: FeedbackItem; index: number; total: number }) {
  const ref = parseRef(f.source_ref);
  const reporter = ref.reporter ? [ref.reporter.name, ref.reporter.email, ref.reporter.id].filter(Boolean).join(" · ") : "";
  return (
    <section className="grid min-w-0 gap-3 border-b border-line pb-5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2 [&>*]:min-w-0 [&>*]:break-all">
        {total > 1 && <span className="num text-xs font-semibold text-ink">反馈 {index + 1}</span>}
        <Chip>{SOURCE_LABEL[f.source] ?? f.source}</Chip>
        {f.scale && (
          <Chip>
            规模 {SCALE_LABEL[f.scale] ?? f.scale}
            {f.scale_confidence !== null ? ` · ${Math.round(f.scale_confidence * 100)}%` : ""}
          </Chip>
        )}
        <span className="num text-xs text-ink-3">提交于 {clockTime(f.created_at)}</span>
        {reporter && <span>提交者：{reporter}</span>}
        {ref.role && <span>身份：{ref.role === "admin" ? "管理员" : "普通用户"}</span>}
        {ref.contact && <span>联系方式：{ref.contact}</span>}
        {ref.page && (
          <a className="break-all text-accent hover:underline" href={ref.page} target="_blank" rel="noreferrer noopener">
            {ref.page}
          </a>
        )}
      </div>
      <h3 className="break-words text-[15px] font-semibold">{f.title}</h3>
      {f.body ? (
        <div className="md text-sm">
          <Markdown remarkPlugins={[remarkGfm]}>{f.body}</Markdown>
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">（没有正文）</p>
      )}
    </section>
  );
}

/** 任务的全部原始反馈。一条时和以前一样；合并任务有多条，按提交顺序排列 */
export function FeedbackList({ feedbacks, loading }: { feedbacks: FeedbackItem[]; loading: boolean }) {
  if (loading)
    return (
      <div role="status" aria-label="加载中" className="grid gap-3 pt-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-24" />
      </div>
    );
  if (feedbacks.length === 0) return <p className="pt-4 text-[13px] text-ink-3">没有原始反馈记录。</p>;
  return (
    <div className="grid min-w-0 gap-5 pt-4">
      {feedbacks.length > 1 && <p className="text-[13px] text-ink-2">这个任务由 {feedbacks.length} 条小反馈合并而成，交给一个会话一次处理。</p>}
      {feedbacks.map((f, i) => (
        <FeedbackBlock key={f.id} f={f} index={i} total={feedbacks.length} />
      ))}
    </div>
  );
}
