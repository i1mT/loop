"use client";
import * as T from "@radix-ui/react-tabs";
import clsx from "clsx";
import type { ReactNode } from "react";

export const Tabs = T.Root;

export function TabList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <T.List aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {children}
    </T.List>
  );
}

export function Tab({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <T.Trigger
      value={value}
      className={clsx(
        "relative -mb-px inline-flex h-10 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink",
        "data-[state=active]:border-ink data-[state=active]:text-ink focus-visible:outline-offset-[-3px]",
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="num rounded-full bg-sunken px-1.5 text-[11px] leading-5 text-ink-2">{count}</span>}
    </T.Trigger>
  );
}

export const TabPanel = T.Content;
