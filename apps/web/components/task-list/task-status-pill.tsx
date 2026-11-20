import clsx from "clsx";
import { CircleX, ClipboardCheck, ClipboardList, CloudUpload, FlaskConical, GitMerge, Hourglass, ScanSearch, SquareTerminal } from "lucide-react";
import { StatusPill } from "@/components/ui/badge.tsx";
import type { StageInfo, TaskPhase } from "@/lib/status.ts";

const PHASE_GLYPHS = {
  queue: { Icon: Hourglass, motion: "turn" },
  plan: { Icon: ClipboardList, motion: "pulse" },
  develop: { Icon: SquareTerminal, motion: "pulse" },
  review: { Icon: ClipboardCheck, motion: "pulse" },
  "preview-deploy": { Icon: CloudUpload, motion: "lift" },
  "preview-test": { Icon: FlaskConical, motion: "rock" },
  release: { Icon: GitMerge, motion: "lift" },
  regression: { Icon: ScanSearch, motion: "scan" },
} satisfies Record<TaskPhase, { Icon: typeof Hourglass; motion: string }>;

export function TaskPhaseIcon({ phase, running }: { phase: TaskPhase; running?: boolean }) {
  const { Icon, motion } = PHASE_GLYPHS[phase];
  return <Icon aria-hidden className="task-status-icon size-3.5 shrink-0" data-motion={running ? motion : undefined} />;
}

export function TaskStatusPill({ info, phase, running }: { info: StageInfo; phase?: TaskPhase; running?: boolean }) {
  const { label, tone, hint } = info;
  const phaseColor = phase && (tone === "idle" || tone === "live" || tone === "review");
  const icon = tone === "bad" ? <CircleX className="size-3.5 shrink-0" aria-hidden />
    : phase ? <TaskPhaseIcon phase={phase} running={running} /> : undefined;
  return (
    <span title={hint || undefined} data-task-phase={phase} className={clsx(running && "inline-block task-status-change")}>
      <StatusPill tone={tone} icon={icon} className={phaseColor ? "task-phase-pill" : undefined}>{label}</StatusPill>
    </span>
  );
}
