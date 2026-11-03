import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Loop", description: "用户反馈到上线的闭环：智能体改代码，你来审核发布", icons: { icon: "/favicon.svg" } };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
