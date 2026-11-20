import { CircleX, CloudUpload, FileCheck2, FlaskConical, Hourglass, Layers, LoaderCircle, Rocket, ScanSearch, SquareTerminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatusPill } from "@/components/ui/badge.tsx";
import { listedTaskStageInfo } from "@/lib/status.ts";

const waiting = { Icon: Hourglass, motion: "turn" };
const deployPreview = { Icon: CloudUpload, motion: "lift" };
const deployProduction = { Icon: Rocket, motion: "lift" };
const ACTIVE_ICONS: Readonly<Record<string, { Icon: LucideIcon; motion: string } | undefined>> = {
  received: waiting,
  queued: waiting,
  batched: { Icon: Layers, motion: "pulse" },
  running: { Icon: SquareTerminal, motion: "pulse" },
  plan_approved: { Icon: FileCheck2, motion: "pulse" },
  approved: waiting,
  publishing: deployProduction,
  preview_deploy: deployPreview,
  production_deploy: deployProduction,
  preview_test: { Icon: FlaskConical, motion: "rock" },
  production_test: { Icon: ScanSearch, motion: "scan" },
};

export function TaskStatusPill({ task }: { task: Parameters<typeof listedTaskStageInfo>[0] }) {
  const { label, tone, group, hint } = listedTaskStageInfo(task);
  let icon;
  if (group === "active") {
    const animation = task.lease_active === false && task.stage === "running" ? waiting : ACTIVE_ICONS[task.stage];
    const { Icon, motion } = animation ?? { Icon: LoaderCircle, motion: "spin" };
    icon = <Icon aria-hidden className="task-status-icon size-3.5 shrink-0" data-motion={motion} />;
  } else if (tone === "bad") {
    icon = <CircleX aria-hidden className="size-3.5 shrink-0" />;
  }
  return <span title={hint || undefined}><StatusPill tone={tone} icon={icon}>{label}</StatusPill></span>;
}
