import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth-server.ts";
import { AppShell } from "@/components/app-shell.tsx";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  if (!(await sessionUser(h, `${proto}://${host}`))) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
