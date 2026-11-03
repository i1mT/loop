import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <header className="mb-6">
      {crumbs && <div className="mb-2 text-[13px] text-ink-2">{crumbs}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.01em]">{title}</h1>
          {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line bg-card ${className ?? ""}`}>{children}</section>;
}
