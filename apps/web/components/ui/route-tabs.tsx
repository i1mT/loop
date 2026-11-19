"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface RouteTab {
  href: string;
  label: string;
  /** 精确匹配（概览页用），否则按前缀匹配 */
  exact?: boolean;
  /** 标签旁的数量角标（大于 0 才显示） */
  count?: number;
}

/** 二级页面的标签导航：每个标签是一个真正的子路由，可直接分享链接、浏览器前进后退可用 */
export function RouteTabs({ tabs, label, className, variant = "default" }: { tabs: RouteTab[]; label: string; className?: string; variant?: "default" | "workspace" }) {
  const path = usePathname();
  const workspace = variant === "workspace";
  return (
    <nav aria-label={label} className={clsx("flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line", workspace && "gap-2 px-2.5 sm:gap-3 sm:px-4", className ?? (workspace ? undefined : "-mt-2 mb-6"))}>
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "relative inline-flex shrink-0 items-center whitespace-nowrap text-[13px] font-medium transition-colors focus-visible:outline-offset-[-3px]",
              workspace ? "h-11 px-1.5 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full" : "-mb-px h-10 border-b-2 px-3",
              active ? (workspace ? "font-semibold text-ink after:bg-signal" : "border-ink text-ink") : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="num ml-1.5 rounded-full bg-sunken px-1.5 text-[11px] leading-5 text-ink-2">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
