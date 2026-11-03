"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px] data-[state=open]:animate-[rise_120ms_ease-out]" />
        <D.Content
          className={`fixed left-1/2 top-[8dvh] z-50 max-h-[84dvh] w-[calc(100vw-32px)] -translate-x-1/2 overflow-y-auto rounded-card border border-line bg-card p-5 shadow-pop ${wide ? "max-w-2xl" : "max-w-lg"}`}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[13px] text-ink-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink" aria-label="关闭">
              <X className="size-4" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
