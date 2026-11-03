import clsx from "clsx";
import { FileDiff } from "lucide-react";

const CHANGE: Record<string, string> = { added: "新增", modified: "修改", deleted: "删除" };

/** 统一 diff 着色：新增绿、删除红、块头灰。行号不做，保持轻量。 */
export function DiffView({ path, change, patch, open }: { path: string; change: string; patch: string; open?: boolean }) {
  const lines = patch.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return (
    <details open={open} className="group overflow-hidden rounded-card border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] hover:bg-canvas/60">
        <FileDiff className="size-4 text-ink-2" aria-hidden />
        <span className="num min-w-0 flex-1 truncate">{path}</span>
        <span className="text-xs text-ink-2">{CHANGE[change] ?? change}</span>
        <span className="num text-xs text-ok">+{added}</span>
        <span className="num text-xs text-bad">-{removed}</span>
      </summary>
      <pre className="num overflow-x-auto border-t border-line py-1 text-xs leading-5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={clsx(
              "min-w-max px-3",
              l.startsWith("+") && !l.startsWith("+++") && "bg-ok-soft text-ok",
              l.startsWith("-") && !l.startsWith("---") && "bg-bad-soft text-bad",
              l.startsWith("@@") && "bg-sunken text-ink-2",
              (l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("---") || l.startsWith("+++")) && "text-ink-3",
            )}
          >
            {l || " "}
          </div>
        ))}
      </pre>
    </details>
  );
}
