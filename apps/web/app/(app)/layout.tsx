import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth-server.ts";
import { requestOrigin } from "@/lib/public-url.ts";
import { AppShell } from "@/components/app-shell.tsx";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  // 服务端组件拿不到请求 URL，只有 Host。协议不要按主机名猜：公网 IP 直接以 HTTP 暴露时
  // 会被猜成 https，会话校验用错 baseURL 就一律判为未登录（登录后又被弹回登录页）。
  const host = h.get("host") ?? "localhost";
  if (!(await sessionUser(h, requestOrigin(h, host)))) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
