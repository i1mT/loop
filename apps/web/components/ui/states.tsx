"use client";
import clsx from "clsx";
import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button.tsx";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

/** 与列表行同形状的骨架，避免加载完成时布局跳动 */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-px" role="status" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 flex-1 max-w-sm" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="hidden h-4 w-20 md:block" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-sunken text-ink-2">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-bad-soft text-bad">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold">加载失败</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-2">{message}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-control border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
      {children}
    </p>
  );
}
