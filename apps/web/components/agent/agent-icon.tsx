"use client";
import * as Select from "@radix-ui/react-select";
import clsx from "clsx";
import { Bot, Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { AGENT_LABEL } from "@/lib/status.ts";

// 智能体图标：原样取自 LobeHub icons 这一个库（见 public/agents/README.md），不裁剪、不重画、不套底色。
// 有彩色版的用彩色版（claude、codex、deepseek），其余是库里的单色版。
const KNOWN = new Set(["claude", "codex", "grok", "opencode", "pi", "dsh"]);

/** 智能体图标。未知的智能体显示通用机器人图标。 */
export function AgentIcon({ kind, size = 18, className }: { kind: string; size?: number; className?: string }) {
  if (!KNOWN.has(kind)) return <Bot aria-hidden width={size} height={size} className={clsx("shrink-0 text-ink-2", className)} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/agents/${kind}.svg`} alt="" aria-hidden width={size} height={size} className={clsx("shrink-0", className)} />;
}

/** 图标 + 名称。页面里所有展示智能体的地方都用它，不要再单写 AGENT_LABEL。 */
export function AgentName({ kind, className, size = 16 }: { kind: string | null | undefined; className?: string; size?: number }) {
  const k = kind ?? "";
  return (
    <span className={clsx("inline-flex items-center gap-1.5 align-middle", className)}>
      <AgentIcon kind={k} size={size} />
      <span>{AGENT_LABEL[k] ?? (k || "未选择")}</span>
    </span>
  );
}

export interface AgentOption {
  value: string;
  /** 不是智能体的选项（如“沿用项目”），用 label 自定义 */
  label?: ReactNode;
  disabled?: boolean;
}

/** 带图标的智能体下拉（原生 select 的选项里放不了图标）。value 为空串表示“未选”，用 placeholder 或对应的 label 选项展示。 */
export function AgentSelect({ value, onChange, options, id, className, placeholder = "请选择", ariaLabel }: { value: string; onChange: (v: string) => void; options: AgentOption[]; id?: string; className?: string; placeholder?: string; ariaLabel?: string }) {
  // Radix 的 Select 不允许空串作为 item 的 value，内部用哨兵值
  const EMPTY = "__empty__";
  const render = (o: AgentOption) => o.label ?? <AgentName kind={o.value} />;
  const current = options.find((o) => o.value === value);
  return (
    <Select.Root value={value === "" ? EMPTY : value} onValueChange={(v) => onChange(v === EMPTY ? "" : v)}>
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        className={clsx(
          "flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-line-strong bg-card px-3 text-left text-sm text-ink transition-colors hover:border-ink-3 focus:border-ink focus:outline-none focus-visible:outline-none disabled:opacity-60",
          className,
        )}
      >
        <span className="min-w-0 truncate">{current ? render(current) : <span className="text-ink-3">{placeholder}</span>}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-2" aria-hidden />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={4} className="z-50 outline-none focus-visible:outline-none min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-line-strong bg-card p-1 shadow-lg">
          <Select.Viewport>
            {options.map((o) => (
              <Select.Item
                key={o.value || EMPTY}
                value={o.value === "" ? EMPTY : o.value}
                disabled={o.disabled}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-sunken"
              >
                <Select.ItemText>{render(o)}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check className="size-4 text-ink-2" aria-hidden />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
