"use client";
import { ChevronRight, Code2, Globe, Plug, Webhook } from "lucide-react";
import Link from "next/link";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { Card } from "@/components/ui/page-header.tsx";

/** 接入：外部系统把任务送进这个项目的方式。每种方式有自己的子页面。 */
export default function Integrations() {
  const { project } = useProjectCtx();
  const base = `/projects/${project.id}/integrations`;
  const methods = [
    { href: `${base}/api`, icon: Plug, title: "API 接入", desc: "你的服务端用项目密钥调用接口，直接把任务推送进来，并可查询进度。适合工单系统、监控告警、内部工具。" },
    { href: `${base}/sdk`, icon: Code2, title: "SDK 接入", desc: "一行脚本嵌入网站前端。访客点右下角的“反馈”按钮，截图、选元素、写说明，自动附带控制台报错和网络请求。" },
  ];
  const later = [
    { icon: Webhook, title: "Webhook 通知", desc: "任务状态变化时回调你的系统" },
    { icon: Globe, title: "更多来源", desc: "GitHub Issues、邮件、聊天机器人等" },
  ];
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-ink-2">选择外部系统把任务送进“{project.name}”的方式。进来的任务和手动创建的一样，由项目绑定的智能体处理、经你审核后发布。</p>
      <div className="grid gap-4 md:grid-cols-2">
        {methods.map((m) => (
          <Link key={m.href} href={m.href} className="group">
            <Card className="h-full p-5 transition-colors group-hover:border-ink-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-control bg-sunken text-ink">
                  <m.icon className="size-5" aria-hidden />
                </span>
                <ChevronRight className="size-4 text-ink-3 group-hover:text-ink" aria-hidden />
              </div>
              <h2 className="text-[15px] font-semibold">{m.title}</h2>
              <p className="mt-1 text-[13px] text-ink-2">{m.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
      <h2 className="mb-2 mt-8 text-[15px] font-semibold">以后支持</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {later.map((m) => (
          <Card key={m.title} className="p-5 opacity-70">
            <div className="mb-3 flex items-center justify-between">
              <span className="grid size-9 place-items-center rounded-control bg-sunken text-ink-2">
                <m.icon className="size-5" aria-hidden />
              </span>
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-2">即将支持</span>
            </div>
            <h3 className="text-[15px] font-semibold">{m.title}</h3>
            <p className="mt-1 text-[13px] text-ink-2">{m.desc}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
