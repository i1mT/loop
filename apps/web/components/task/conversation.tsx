"use client";
import clsx from "clsx";
import { ArrowDown, Brain, Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, MessageCircle, Send, Terminal, Wrench } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentName } from "@/components/agent/agent-icon.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/field.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate } from "@/lib/client-api.ts";
import { fold, type Ev, type Item, type Pending } from "@/lib/session-fold.ts";
import { SESSION_STATE_LABEL, startsNewRound, type TaskProgress } from "@/lib/status.ts";
import type { TaskItem } from "@/lib/types.ts";

const TOOL_STATUS: Record<string, string> = { pending: "等待", in_progress: "进行中", completed: "完成", failed: "失败" };

/** 从完整指令里取“## 任务”之后的标题行，用作折叠时的摘要 */
function taskPart(text: string): string {
  const m = text.match(/##\s*任务\s*\n标题[：:]\s*(.+)/);
  return m ? m[1].trim().slice(0, 80) : text.slice(0, 60);
}

function Md({ text }: { text: string }) {
  return (
    <div className="md max-w-[68ch] text-sm">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

const toolPending = (status: string) => status === "in_progress" || status === "pending";

function ToolGroup({ tools, live }: { tools: Extract<Item, { type: "tool" }>[]; live: boolean }) {
  const open = tools.some((t) => toolPending(t.status));
  const failed = tools.filter((t) => t.status === "failed").length;
  const single = tools.length === 1 ? tools[0] : null;
  const statusLabel = open ? (live ? "进行中" : "未返回结果") : failed ? (single ? "失败" : `${failed} 项失败`) : null;
  return (
    <details className={clsx("group rounded-lg border text-[13px] transition-colors", open && live ? "border-signal/25 bg-signal-soft/45" : "border-line bg-card/65")}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-ink-2 hover:bg-sunken/45 hover:text-ink">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {open && live ? <LoaderCircle className="size-3.5 shrink-0 text-signal motion-safe:animate-spin" aria-hidden /> : <Wrench className="size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{single?.title ?? `${tools.length} 次工具调用`}</span>
        {statusLabel && <span className={clsx("shrink-0 text-xs", failed && !open ? "text-bad" : "text-ink-2")}>{statusLabel}</span>}
      </summary>
      <ul className="grid gap-1 border-t border-line px-2.5 py-2">
        {tools.map((t) => (
          <li key={t.key} className="flex items-start gap-2">
            <Terminal className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span className="num min-w-0 flex-1 break-all text-xs">{t.title}</span>
            <span className={clsx("shrink-0 text-xs", t.status === "failed" ? "text-bad" : "text-ink-3")}>{!live && toolPending(t.status) ? "未返回结果" : TOOL_STATUS[t.status] ?? t.status}</span>
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
          // 长消息按需展开，避免把历史任务指令铺满会话。
          <details className="group min-w-0 max-w-[88%] justify-self-end rounded-xl rounded-br-sm bg-sunken/70 px-3.5 py-2.5 [overflow-wrap:anywhere]">
            <summary className="cursor-pointer list-none text-[13px] text-ink-2 hover:text-ink">
              <span className="font-medium text-ink">{item.text.includes("## 任务") ? "任务指令" : "长消息"}</span>
              <span className="ml-2">{taskPart(item.text)}</span>
              <span className="ml-2 text-xs text-ink-3 group-open:hidden">展开全文</span>
            </summary>
            <div className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-xs leading-relaxed text-ink-2">{item.text}</div>
          </details>
        ) : (
          <div className="grid max-w-[88%] min-w-0 justify-self-end gap-1.5">
            <span className="justify-self-end pr-0.5 text-xs font-medium text-ink-2">你</span>
            <p className="whitespace-pre-wrap rounded-xl rounded-br-sm bg-sunken/70 px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">{item.text}</p>
          </div>
        )
      ) : (
        <Md text={item.text} />
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
      return item.detail && !["starting", "running", "idle"].includes(item.state) ? <div className="text-xs text-ink-3">{SESSION_STATE_LABEL[item.state] ?? item.state}：{item.detail}</div> : null;
    case "stop":
      return null;
    case "error":
      return <p className="rounded-control bg-bad-soft px-3 py-2 text-[13px] text-bad">错误：{item.message}</p>;
    case "check":
      return (
        <p className={clsx("flex items-center gap-1.5 text-xs", item.ok ? "text-ok" : "text-bad")}>
          {item.ok ? <Check className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}
          {{ test: "测试", preview: "预览", publish: "推送与 PR" }[item.name] ?? item.name}{item.ok ? "通过" : "未通过"}
        </p>
      );
    default:
      return null;
  }
}

/** 按顺序渲染，连续的工具调用合并为一组，diff 与 usage 不在对话里出现（有单独的标签页） */
function Items({ items, agent, onAnswer, busy, answering, live }: { items: Item[]; agent: string; onAnswer: (id: string) => void; busy: boolean; answering: string | null; live: boolean }) {
  const out: React.ReactNode[] = [];
  let tools: Extract<Item, { type: "tool" }>[] = [];
  let reply: React.ReactNode[] = [];
  let replyKey: string | null = null;
  const lastUserMessage = items.findLastIndex((item) => item.type === "message" && item.role === "user");
  let currentTurn = lastUserMessage < 0;

  function flushTools() {
    if (!tools.length) return;
    reply.push(<ToolGroup key={`g${tools[0].key}`} tools={tools} live={live && currentTurn} />);
    tools = [];
  }

  function flushReply() {
    flushTools();
    if (!replyKey) return;
    out.push(
      <div key={replyKey} className="grid min-w-0 gap-2.5">
        <AgentName kind={agent} size={15} className="w-fit text-[13px] font-semibold text-ink" />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 border-l border-line pl-3.5 sm:pl-4">{reply}</div>
      </div>,
    );
    reply = [];
    replyKey = null;
  }

  for (const [index, item] of items.entries()) {
    if (item.type === "diff" || item.type === "usage" || item.type === "stop") continue;
    if (item.type === "status" && (!item.detail || ["starting", "running", "idle"].includes(item.state))) continue;
    if (item.type === "message" && item.role === "user") {
      flushReply();
      currentTurn = index === lastUserMessage;
      out.push(<Row key={item.key} item={item} onAnswer={onAnswer} busy={busy} answering={answering} />);
      continue;
    }
    replyKey ??= item.key;
    if (item.type === "tool") {
      tools.push(item);
      continue;
    }
    flushTools();
    reply.push(<Row key={item.key} item={item} onAnswer={onAnswer} busy={busy} answering={answering} />);
  }
  flushReply();
  return <>{out}</>;
}

export function Conversation({ task, events, pending, activity, reload, hasMore, loadingOlder, loadOlder }: { task: TaskItem; events: Ev[]; pending: Pending[]; activity: TaskProgress["activity"]; reload: () => void; hasMore: boolean; loadingOlder: boolean; loadOlder: () => void }) {
  const taskId = task.id;
  const newRound = startsNewRound(task.stage, !!task.merge_sha);
  const sendingAfterPublish = task.stage === "publishing";
  const toast = useToast();
  const { items } = useMemo(() => fold(events), [events]);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const draftKey = `loop.task-draft.${taskId}`;
  const draft = useRef("");

  useEffect(() => {
    try {
      draft.current = sessionStorage.getItem(draftKey) ?? "";
      setText(draft.current);
    } catch { /* 浏览器可能禁用了存储 */ }
  }, [draftKey]);

  function updateDraft(value: string) {
    draft.current = value;
    setText(value);
    setSendError(null);
    try {
      if (value) sessionStorage.setItem(draftKey, value);
      else sessionStorage.removeItem(draftKey);
    } catch { /* 当前会话仍可发送 */ }
  }
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
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
  }, [events, pending.length, activity?.label]);

  // 输入区变高、窗口缩放或图片加载时，继续跟随最新消息。正在翻历史时保留当前位置。
  useEffect(() => {
    const scrollBox = box.current;
    const content = transcript.current;
    if (!scrollBox || !content) return;
    const observer = new ResizeObserver(() => {
      if (stick.current) scrollBox.scrollTop = scrollBox.scrollHeight;
    });
    observer.observe(scrollBox);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

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
    setSendError(null);
    setBusy(true);
    try {
      const result = await apiPost<{ deferred: boolean }>(`/api/tasks/${taskId}/reply`, { text });
      if (draft.current === text) updateDraft("");
      goToLatest();
      mutate("/api/tasks");
      if (result.deferred) toast("ok", "消息已保存，当前发布结束后交给智能体继续开发");
      reload();
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : "消息发送失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function goToLatest() {
    stick.current = true;
    setAwayFromLatest(false);
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
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

  const pendingMessages = pending.filter((item) => item.kind !== "rewind");
  const empty = !items.length && !pendingMessages.length && !hasMore;
  const hint = sendingAfterPublish
    ? "本次发布结束后处理"
    : newRound ? "在原会话中继续开发，新改动会另开 PR" : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={box}
          role="region"
          aria-label="会话历史"
          tabIndex={0}
          className="task-conversation-history min-h-28 flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none] focus-visible:outline-offset-[-3px] sm:px-6 sm:py-5"
          onScroll={(e) => {
            const el = e.currentTarget;
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            stick.current = nearBottom;
            setAwayFromLatest(!nearBottom);
            if (!nearBottom && el.scrollTop < 40) showOlder();
          }}
          onWheel={(e) => { if (e.deltaY < 0 && e.currentTarget.scrollTop < 40) showOlder(); }}
        >
          <div ref={transcript} className={clsx("mx-auto grid max-w-[50rem] min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:gap-5", empty && "min-h-full place-content-center justify-items-center")}>
            {hasMore && <div className="flex justify-center">
              <Button size="sm" variant="ghost" loading={loadingOlder} onClick={showOlder}>加载更早的消息</Button>
            </div>}
            {empty && (
              <div className="grid justify-items-center gap-2.5 px-4 py-3 text-center">
                <span className="grid size-10 place-items-center rounded-xl border border-line bg-canvas/55 text-ink-2">
                  <MessageCircle className="size-[18px]" aria-hidden />
                </span>
                <h2 className="text-sm font-semibold">会话还未开始</h2>
                <p className="max-w-[26rem] text-pretty text-[13px] leading-5 text-ink-2">智能体领取任务后，进度会出现在这里。你可以先发消息补充要求。</p>
              </div>
            )}
            {items.length > 0 && <Items items={items} agent={task.agent} onAnswer={answer} busy={busy || !activity?.waiting || pending.some((p) => p.kind === "decision")} answering={answering} live={!!activity?.agentRunning} />}
            {pendingMessages.map((item) => (
              <div key={item.id} className="grid max-w-[90%] min-w-0 justify-self-end gap-1">
                <p className="whitespace-pre-wrap rounded-xl rounded-br-sm break-words bg-sunken/65 px-3.5 py-2.5 text-sm [overflow-wrap:anywhere]">{item.kind === "decision" ? "已提交选择" : item.body}</p>
                <span className="flex items-center justify-end gap-1 text-xs text-ink-3"><Clock3 className="size-3" aria-hidden />{sendingAfterPublish ? "发布结束后送达" : "等待智能体接收"}</span>
              </div>
            ))}
          </div>
        </div>
        {awayFromLatest && <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center">
          <Button size="sm" className="pointer-events-auto rounded-full shadow-pop" onClick={goToLatest}><ArrowDown className="size-3.5" aria-hidden /> 最新消息</Button>
        </div>}
      </div>
      <div id="task-reply" className="shrink-0 scroll-mt-14 rounded-b-[14px] border-t border-line bg-canvas/45 px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-[50rem]">
          {activity && <div role="status" className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-2">
            {activity.spinning ? <LoaderCircle className="size-3.5 shrink-0 text-signal motion-safe:animate-spin" aria-hidden /> : <Clock3 className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
            {activity.label}
          </div>}
          <form className="rounded-xl border border-line-strong bg-card transition-colors focus-within:border-ink-3 focus-within:ring-1 focus-within:ring-ink-3/20" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <Textarea
              aria-label="给智能体的消息"
              aria-describedby={hint || sendError ? "task-reply-feedback" : undefined}
              value={text}
              onChange={(e) => updateDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
              }}
              rows={1}
              className="block max-h-[min(24dvh,8rem)] min-h-11! resize-none! rounded-none border-0 bg-transparent px-3.5 pt-2.5 pb-1.5 [field-sizing:content]"
              placeholder={activity?.waiting ? "回复智能体…" : "给智能体发消息…"}
            />
            <div className="flex items-center gap-2 px-2 pb-2 pl-3.5">
              {hint && !sendError && <p id="task-reply-feedback" className="min-w-0 flex-1 text-xs leading-4 text-ink-3">{hint}</p>}
              <span aria-hidden className="ml-auto hidden shrink-0 text-[11px] text-ink-3 sm:block">⌘ / Ctrl + Enter</span>
              <Button type="submit" variant="primary" size="sm" className="ml-auto shrink-0 sm:ml-0" loading={busy} disabled={!text.trim()}>
                {!busy && <Send className="size-3.5" aria-hidden />} 发送
              </Button>
            </div>
          </form>
          {sendError && <p id="task-reply-feedback" role="alert" className="mt-2 text-xs text-bad">{sendError}</p>}
        </div>
      </div>
    </div>
  );
}
