"use client";
import clsx from "clsx";
import { Brain, ChevronRight, Send, Terminal, Wrench } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/field.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate } from "@/lib/client-api.ts";
import { fold, type Ev, type Item, type Pending } from "@/lib/session-fold.ts";
import { SESSION_STATE_LABEL, startsNewRound } from "@/lib/status.ts";
import type { TaskItem } from "@/lib/types.ts";

const TOOL_STATUS: Record<string, string> = { pending: "等待", in_progress: "进行中", completed: "完成", failed: "失败" };

/** 从完整指令里取“## 任务”之后的标题行，用作折叠时的摘要 */
function taskPart(text: string): string {
  const m = text.match(/##\s*任务\s*\n标题[：:]\s*(.+)/);
  return m ? m[1].trim().slice(0, 80) : text.slice(0, 60);
}

function Md({ text }: { text: string }) {
  return (
    <div className="md text-sm">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

function ToolGroup({ tools }: { tools: Extract<Item, { type: "tool" }>[] }) {
  const running = tools.some((t) => t.status === "in_progress" || t.status === "pending");
  const failed = tools.filter((t) => t.status === "failed").length;
  return (
    <details className="group rounded-control border border-line bg-card/70 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-ink-2 hover:text-ink">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        <Wrench className="size-3.5" aria-hidden />
        <span>
          {tools.length} 次工具调用{running ? "（进行中）" : ""}
          {failed > 0 && <span className="text-bad">，{failed} 次失败</span>}
        </span>
      </summary>
      <ul className="grid gap-1 border-t border-line px-2.5 py-2">
        {tools.map((t) => (
          <li key={t.key} className="flex items-start gap-2">
            <Terminal className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span className="num min-w-0 flex-1 break-all text-xs">{t.title}</span>
            <span className={clsx("shrink-0 text-xs", t.status === "failed" ? "text-bad" : "text-ink-3")}>{TOOL_STATUS[t.status] ?? t.status}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Row({ item, onAnswer, busy, answering }: { item: Item; onAnswer: (id: string) => void; busy: boolean; answering: string | null }) {
  switch (item.type) {
    case "message":
      return item.role === "user" ? (
        item.text.length > 400 ? (
          // 首条消息是系统发给智能体的完整指令（含工程师规范），默认折叠，只显示任务部分
          <details className="group max-w-[85%] justify-self-end rounded-card rounded-br-sm bg-sunken px-3.5 py-2.5">
            <summary className="cursor-pointer list-none text-[13px] text-ink-2 hover:text-ink">
              <span className="font-medium text-ink">任务指令</span>
              <span className="ml-2">{taskPart(item.text)}</span>
              <span className="ml-2 text-xs text-ink-3 group-open:hidden">展开完整指令</span>
            </summary>
            <div className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-xs leading-relaxed text-ink-2">{item.text}</div>
          </details>
        ) : (
          <div className="max-w-[85%] justify-self-end rounded-card rounded-br-sm bg-sunken px-3.5 py-2.5">
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.text}</div>
          </div>
        )
      ) : (
        <div className="max-w-[92%]">
          <Md text={item.text} />
        </div>
      );
    case "thought":
      return (
        <details className="group text-[13px] text-ink-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-ink">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            <Brain className="size-3.5" aria-hidden />
            思考过程
          </summary>
          <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-line pl-3 text-xs leading-relaxed">{item.text}</div>
        </details>
      );
    case "needs_you":
      return (
        <div className={clsx("rounded-card border p-3.5", item.answered ? "border-line bg-card" : "border-signal/60 bg-signal-soft")} role={item.answered ? undefined : "group"} aria-label="需要你的决定">
          <p className="text-sm">{item.question}</p>
          {item.answered ? (
            <p className="mt-2 text-xs text-ink-2">已回答</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.options.map((o) => (
                <Button key={o.id} size="sm" variant={o.id === "allow-once" || o.id === "allow" ? "primary" : "secondary"} loading={answering === o.id} disabled={busy} onClick={() => onAnswer(o.id)}>
                  {o.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      );
    case "status":
      return <div className="text-center text-xs text-ink-3">{SESSION_STATE_LABEL[item.state] ?? item.state}{item.detail ? `：${item.detail}` : ""}</div>;
    case "stop":
      return <div className="text-center text-xs text-ink-3">本轮结束</div>;
    case "error":
      return <p className="rounded-control bg-bad-soft px-3 py-2 text-[13px] text-bad">错误：{item.message}</p>;
    case "check":
      return (
        <p className={clsx("text-center text-xs", item.ok ? "text-ok" : "text-bad")}>
          {{ test: "测试", preview: "预览", publish: "推送与 PR" }[item.name] ?? item.name}：{item.ok ? "通过" : "未通过"}
        </p>
      );
    default:
      return null;
  }
}

/** 按顺序渲染，连续的工具调用合并为一组，diff 与 usage 不在对话里出现（有单独的标签页） */
function Items({ items, onAnswer, busy, answering }: { items: Item[]; onAnswer: (id: string) => void; busy: boolean; answering: string | null }) {
  const out: React.ReactNode[] = [];
  let tools: Extract<Item, { type: "tool" }>[] = [];
  const flush = () => {
    if (tools.length) out.push(<ToolGroup key={`g${tools[0].key}`} tools={tools} />);
    tools = [];
  };
  for (const it of items) {
    if (it.type === "tool") {
      tools.push(it);
      continue;
    }
    if (it.type === "diff" || it.type === "usage") continue;
    flush();
    out.push(<Row key={it.key} item={it} onAnswer={onAnswer} busy={busy} answering={answering} />);
  }
  flush();
  return <>{out}</>;
}

export function Conversation({ task, events, pending, waiting, reload, hasMore, loadingOlder, loadOlder }: { task: TaskItem; events: Ev[]; pending: Pending[]; waiting: boolean; reload: () => void; hasMore: boolean; loadingOlder: boolean; loadOlder: () => void }) {
  const taskId = task.id;
  const newRound = startsNewRound(task.stage, !!task.merge_sha);
  const sendingAfterPublish = task.stage === "publishing";
  const toast = useToast();
  const { items } = useMemo(() => fold(events), [events]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loadingOlderRef = useRef(false);
  const prevHeight = useRef<number | null>(null);
  const oldest = events[0]?.seq;

  // 加载历史时保留阅读位置。普通更新（包括同一条消息持续输出）跟随最新内容。
  useLayoutEffect(() => {
    const el = box.current;
    if (el && prevHeight.current !== null) el.scrollTop += el.scrollHeight - prevHeight.current;
    prevHeight.current = null;
  }, [oldest]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events, pending.length]);

  useEffect(() => {
    if (!loadingOlder) {
      loadingOlderRef.current = false;
      prevHeight.current = null;
    }
  }, [loadingOlder]);

  function showOlder() {
    const el = box.current;
    if (!el || !hasMore || loadingOlder || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    stick.current = false;
    prevHeight.current = el.scrollHeight;
    loadOlder();
  }

  async function send() {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const result = await apiPost<{ deferred: boolean }>(`/api/tasks/${taskId}/reply`, { text });
      setText((draft) => draft === text ? "" : draft);
      stick.current = true;
      mutate("/api/tasks");
      if (result.deferred) toast("ok", "消息已保存，当前发布结束后交给智能体继续开发");
      reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  async function answer(optionId: string) {
    setBusy(true);
    setAnswering(optionId);
    try {
      await apiPost(`/api/tasks/${taskId}/answer`, { optionId });
      reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "提交失败");
    } finally {
      setBusy(false);
      setAnswering(null);
    }
  }

  return (
    <div className="flex flex-col">
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (!stick.current && el.scrollTop < 48) showOlder();
        }}
        onWheel={(e) => {
          if (e.deltaY < 0 && e.currentTarget.scrollTop < 48) showOlder();
        }}
        className="h-[clamp(16rem,52dvh,38rem)] overflow-y-auto [overflow-anchor:none] px-1 py-4"
        aria-label="会话历史"
        aria-live="polite"
        role="region"
        tabIndex={0}
      >
        <div className="grid min-h-full content-end gap-3">
          {hasMore && (
            <div className="flex justify-center">
              <Button size="sm" variant="ghost" loading={loadingOlder} onClick={showOlder}>加载更早的消息</Button>
            </div>
          )}
          {items.length === 0 ? <p className="py-10 text-center text-sm text-ink-2">还没有会话内容。机器领取任务后，智能体的输出会实时显示在这里。</p> : <Items items={items} onAnswer={answer} busy={busy || pending.some((p) => p.kind === "decision")} answering={answering} />}
          {pending.filter((p) => p.kind !== "rewind").map((p) => (
            <p key={p.id} className="max-w-full justify-self-end whitespace-pre-wrap break-words text-xs text-ink-3">
              {p.kind === "decision" ? `已提交回答：${p.optionId}` : `已发送：${p.body}`}（{sendingAfterPublish ? "发布结束后继续" : "等待智能体处理"}）
            </p>
          ))}
        </div>
      </div>
      <form
        className="border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label="给智能体的消息"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder={waiting ? "智能体在等你回复，也可以选择上方的选项" : "给智能体发消息（⌘/Ctrl + Enter）"}
        />
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {newRound && <p className="mr-auto text-xs text-ink-3">发送后沿用原会话继续开发，改动会进入新的 PR。</p>}
          {sendingAfterPublish && <p className="mr-auto text-xs text-ink-3">消息将在当前发布结束后交给智能体处理。</p>}
          <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>
            <Send className="size-4" aria-hidden />
            发送
          </Button>
        </div>
      </form>
    </div>
  );
}
