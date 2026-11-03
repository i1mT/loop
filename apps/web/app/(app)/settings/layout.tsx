"use client";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header.tsx";
import { RouteTabs } from "@/components/ui/route-tabs.tsx";

/** 设置的外壳：连接与账户 / 小问题合并，每个标签是独立的子路由 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="设置" description="连接、账户与全局规则。" />
      <RouteTabs
        label="设置"
        tabs={[
          { href: "/settings", label: "连接与账户", exact: true },
          { href: "/settings/accounts", label: "账号" },
          { href: "/settings/space", label: "当前空间" },
          { href: "/settings/feishu", label: "飞书" },
          { href: "/settings/merge", label: "小问题合并" },
        ]}
      />
      {children}
    </>
  );
}
