"use client";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { BindingDialog } from "@/components/feishu/binding-dialog.tsx";
import { RouteDialog } from "@/components/feishu/route-dialog.tsx";
import type { FeishuSettings } from "@/components/feishu/types.ts";
import { StatusPill } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CopyBlock } from "@/components/ui/copy-block.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiDelete, apiPost, useApi } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";

export default function FeishuSettingsPage() {
  const result = useApi<FeishuSettings>("/api/feishu/settings", {
    poll: 10000,
  });
  const [edit, setEdit] = useState(false);
  const [route, setRoute] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; expiresAt: number } | null>(
    null,
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const toast = useToast();
  const data = result.data;
  async function action(key: string, operation: () => Promise<void>) {
    setBusy(key);
    try {
      await operation();
      result.reload();
    } catch (e) {
      toast(
        "error",
        e instanceof ApiError ? e.message : "操作失败，请稍后重试",
      );
    } finally {
      setBusy(null);
    }
  }
  const saved = () => {
    result.reload();
    toast("ok", "配置已经保存");
  };
  if (result.loading)
    return (
      <div className="grid gap-4" role="status" aria-label="加载飞书设置">
        <Skeleton className="h-48" />
        <Skeleton className="h-36" />
      </div>
    );
  if (!data)
    return (
      <ErrorState
        message={result.error?.message ?? "无法读取飞书设置"}
        onRetry={result.reload}
      />
    );
  const binding = data.binding;
  const failed = data.jobs.filter(
    (job) => job.state === "failed" || job.state === "pending" || job.error,
  );
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">当前空间的飞书机器人</h2>
          <p className="mt-1 text-sm text-ink-2">
            从聊天创建任务，并在飞书中查看进度与技术方案。
          </p>
        </div>
        {data.canManage && binding && (
          <Button onClick={() => setEdit(true)}>修改配置</Button>
        )}
      </div>
      {binding ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-control bg-sunken">
                <MessageCircle className="size-5 text-ink-2" />
              </div>
              <div>
                <h3 className="font-semibold">飞书应用机器人</h3>
                <p className="num mt-1 break-all text-xs text-ink-2">
                  {binding.appId}
                </p>
              </div>
            </div>
            <StatusPill tone={binding.enabled ? "ok" : "idle"}>
              {binding.enabled
                ? binding.callbackVerifiedAt
                  ? "已启用"
                  : "等待配置消息接收"
                : "已停用"}
            </StatusPill>
          </div>
          <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-ink-2">技术方案目录</p>
              <a
                href={binding.wikiUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-flex items-center gap-1.5 text-sm hover:underline"
              >
                <FileText className="size-4" />
                打开飞书目录
                <ExternalLink className="size-3" />
              </a>
            </div>
            <div>
              <p className="text-xs text-ink-2">单聊默认项目</p>
              <p className="mt-1 text-sm">
                {data.projects.find((p) => p.id === binding.defaultProjectId)
                  ?.name ?? "创建时选择项目"}
              </p>
            </div>
          </div>
          {data.canManage && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-medium">消息接收地址</p>
                <Button
                  size="sm"
                  loading={busy === "check"}
                  onClick={() =>
                    void action("check", async () => {
                      const checked = await apiPost<{ message: string }>(
                        "/api/feishu/check",
                      );
                      toast("ok", checked.message || "机器人与目录连接正常");
                    })
                  }
                >
                  检查连接
                </Button>
              </div>
              <CopyBlock text={binding.callbackUrl} />
              <p className="mt-2 text-[13px] text-ink-2">
                {binding.callbackVerifiedAt
                  ? "飞书消息接收地址已经通过验证。"
                  : "保存上面的接收地址后，飞书会自动验证连接。"}
                {binding.tenantVerified
                  ? " 企业归属已经验证。"
                  : " 企业归属会在收到第一条已验证消息后自动记录。"}
              </p>
              <p className="mt-2 text-xs text-ink-2">
                在企业自建应用的「事件与回调 →
                事件配置」选择「将事件发送至开发者服务器」，粘贴这个地址并保存，再添加「接收消息」事件。
              </p>
              <p className="mt-2 text-xs text-ink-3">
                最近收到消息：
                {binding.lastEventAt
                  ? timeAgo(binding.lastEventAt)
                  : "还没有收到过（飞书没有把消息送到这里）"}
              </p>
              {binding.tenantMismatchAt ? (
                <div className="mt-3 rounded-control bg-warn-soft p-3">
                  <p className="text-[13px] font-medium text-warn">
                    收到来自其他企业的消息，已经被拒绝
                  </p>
                  <p className="mt-1 text-xs text-ink-2">
                    当前记录的企业
                    <span className="num mx-1 break-all">
                      {binding.tenantKey || "（空）"}
                    </span>
                    与消息来自的企业
                    <span className="num mx-1 break-all">
                      {binding.tenantMismatchKey || "（未知）"}
                    </span>
                    不一致，因此不会回复。应用被多个企业安装、或早期用测试事件建立过归属时会出现这种情况。
                  </p>
                  <Button
                    className="mt-2"
                    size="sm"
                    loading={busy === "tenant"}
                    onClick={() =>
                      void action("tenant", async () => {
                        await apiPost("/api/feishu/tenant", {});
                        toast("ok", "已清除企业归属，下一条消息会重新记录");
                      })
                    }
                  >
                    重新建立企业归属
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<MessageCircle className="size-5" />}
            title="还没有绑定飞书机器人"
            action={
              data.canManage ? (
                <Button variant="primary" onClick={() => setEdit(true)}>
                  绑定机器人
                </Button>
              ) : undefined
            }
          >
            绑定后，可以在单聊或群聊中创建任务，技术方案会自动保存到指定目录。
            {!data.canManage && "请联系空间管理员完成绑定。"}
          </EmptyState>
        </Card>
      )}
      {binding && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">我的飞书账号</h3>
                <p className="mt-1 text-[13px] text-ink-2">
                  关联后，机器人才能确认你的空间权限。
                </p>
              </div>
              {data.linked ? (
                <StatusPill tone="ok">
                  <CheckCircle2 className="size-3" />
                  已经关联
                </StatusPill>
              ) : (
                <Button
                  loading={busy === "link"}
                  onClick={() =>
                    void action("link", async () =>
                      setLink(
                        await apiPost<{ code: string; expiresAt: number }>(
                          "/api/feishu/link",
                        ),
                      ),
                    )
                  }
                >
                  关联账号
                </Button>
              )}
            </div>
            {data.canManage && data.identities.length > 0 && (
              <p className="mt-4 border-t border-line pt-3 text-xs text-ink-2">
                当前已有 {data.identities.length} 位成员关联飞书账号。
              </p>
            )}
          </Card>
          {data.canManage && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold">群聊与项目</h3>
                  <p className="mt-1 text-[13px] text-ink-2">
                    群内 @ 机器人时，任务会创建到对应项目。
                  </p>
                </div>
                <Button size="sm" onClick={() => setRoute(true)}>
                  连接群聊
                </Button>
              </div>
              {data.routes.length === 0 ? (
                <EmptyState title="还没有连接群聊">
                  单聊仍然可以创建任务。连接群聊后，已关联账号的成员可以在群内提交需求。
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {data.routes.map((item) => (
                    <li
                      key={item.chatId}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {item.chatName || "已连接的群聊"}
                        </p>
                        <p className="mt-1 text-xs text-ink-2">
                          任务项目：
                          {data.projects.find((p) => p.id === item.projectId)
                            ?.name ?? "项目不可用"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill tone={item.enabled ? "ok" : "idle"}>
                          {item.enabled ? "已连接" : "已停用"}
                        </StatusPill>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setRemoving(item.chatId)}
                        >
                          移除
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {data.canManage && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold">消息与文档同步</h3>
                  <p className="mt-1 text-[13px] text-ink-2">
                    网络中断后会自动重试，也可以手动重新处理。
                  </p>
                </div>
                <Button
                  size="sm"
                  loading={busy === "jobs"}
                  disabled={failed.length === 0}
                  onClick={() =>
                    void action("jobs", async () => {
                      await apiPost("/api/feishu/jobs", {});
                      toast("ok", "已经安排重新处理");
                    })
                  }
                >
                  <RefreshCw className="size-3.5" />
                  重新处理
                </Button>
              </div>
              {failed.length === 0 ? (
                <div className="flex items-center gap-2 px-5 py-6 text-sm text-ink-2">
                  <CheckCircle2 className="size-4 text-ok" />
                  目前没有需要处理的同步问题。
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {failed.map((job) => (
                    <li key={job.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {job.kind.includes("doc") || job.kind.includes("plan")
                            ? "技术方案同步"
                            : "聊天消息处理"}
                        </p>
                        <span className="text-xs text-ink-3">
                          {timeAgo(job.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-[13px] text-ink-2">
                        {job.error || "正在等待重新处理"}
                      </p>
                      <p className="mt-1 text-xs text-ink-3">
                        已经尝试 {job.attempts} 次
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
      {result.error && (
        <p role="alert" className="text-sm text-bad">
          刷新失败：{result.error.message}
        </p>
      )}
      {edit && (
        <BindingDialog
          data={data}
          open={edit}
          onOpenChange={setEdit}
          saved={saved}
        />
      )}
      {route && (
        <RouteDialog
          data={data}
          open={route}
          onOpenChange={setRoute}
          saved={saved}
        />
      )}
      <Dialog
        open={!!link}
        onOpenChange={(value) => !value && setLink(null)}
        title="关联你的飞书账号"
        description="打开与机器人的单聊，发送下面这条消息。关联成功后，可以直接提交任务。"
      >
        {link && (
          <>
            <CopyBlock text={`绑定 ${link.code}`} />
            <p className="mt-3 text-xs text-ink-2">
              绑定码会在{" "}
              {new Date(link.expiresAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              过期，只能使用一次。
            </p>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={() => {
                  setLink(null);
                  result.reload();
                }}
              >
                完成
              </Button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(value) => !value && setRemoving(null)}
        title="移除这个群聊？"
        description="移除后，这个群将不能再通过机器人创建任务。"
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>取消</Button>
          <Button
            variant="danger"
            loading={busy === "remove"}
            onClick={() =>
              void action("remove", async () => {
                await apiDelete(
                  `/api/feishu/routes?chatId=${encodeURIComponent(removing!)}`,
                );
                setRemoving(null);
                toast("ok", "群聊连接已经移除");
              })
            }
          >
            确认移除
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
