"use client";
import { ExternalLink } from "lucide-react";
import { ChatPicker } from "./chat-picker.tsx";
import { SecretInput } from "./secret-input.tsx";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Checkbox, Field, Input } from "@/components/ui/field.tsx";
import { Picker } from "@/components/ui/select.tsx";
import { InlineError } from "@/components/ui/states.tsx";
import { ApiError, apiPost, apiPut } from "@/lib/client-api.ts";
import type { FeishuSettings } from "./types.ts";

export function BindingDialog({
  data,
  open,
  onOpenChange,
  saved,
}: {
  data: FeishuSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saved: () => void;
}) {
  const b = data.binding;
  const [form, setForm] = useState({
    appId: b?.appId ?? "",
    appSecret: "",
    verificationToken: "",
    encryptKey: "",
    wikiUrl: b?.wikiUrl ?? "",
    defaultProjectId: b?.defaultProjectId ?? "none",
    notificationChatId: b?.notificationChatId ?? "",
    notificationChatName: b?.notificationChatName ?? "",
    enabled: b?.enabled ?? true,
  });
  const [credentialsLoading, setCredentialsLoading] = useState(!!b?.hasSecrets);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [credentialAttempt, setCredentialAttempt] = useState(0);
  useEffect(() => {
    if (!b?.hasSecrets || !open) return;
    let active = true;
    setCredentialsLoading(true);
    setCredentialsError(null);
    apiPost<{
      credentials: {
        appSecret: string;
        verificationToken: string;
        encryptKey: string;
      };
    }>("/api/feishu/credentials")
      .then((result) => {
        if (active) setForm((old) => ({ ...old, ...result.credentials }));
      })
      .catch((e) => {
        if (active)
          setCredentialsError(
            e instanceof ApiError ? e.message : "无法读取已保存凭证，请重试",
          );
      })
      .finally(() => {
        if (active) setCredentialsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [b?.id, open, credentialAttempt]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof typeof form, value: string | boolean) =>
    setForm((old) => ({
      ...old,
      [key]: value,
      ...(key === "appId" && value !== old.appId
        ? { notificationChatId: "", notificationChatName: "" }
        : {}),
    }));
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPut("/api/feishu/settings", {
        ...form,
        defaultProjectId:
          form.defaultProjectId === "none" ? null : form.defaultProjectId,
        notificationChatId: form.notificationChatId.trim() || null,
        appSecret: form.appSecret || undefined,
        verificationToken: form.verificationToken || undefined,
        encryptKey: form.encryptKey || undefined,
      });
      saved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={b ? "修改飞书机器人" : "绑定飞书机器人"}
      description="支持企业自建应用。先填写应用凭证和事件验证信息，保存后配置消息接收地址。"
      wide
    >
      <form className="grid gap-4" onSubmit={save}>
        {credentialsLoading && (
          <p role="status" className="text-[13px] text-ink-2">
            正在读取已保存的凭证…
          </p>
        )}
        {credentialsError && (
          <div className="flex items-center justify-between gap-2">
            <InlineError>{credentialsError}</InlineError>
            <Button
              size="sm"
              onClick={() => setCredentialAttempt((value) => value + 1)}
            >
              重新读取凭证
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-sunken px-3 py-2.5 text-[13px]">
          <span>企业自建应用 · 服务器接收消息</span>
          <a
            href={
              /^cli_[A-Za-z0-9]+$/.test(form.appId)
                ? `https://open.feishu.cn/app/${encodeURIComponent(form.appId)}`
                : "https://open.feishu.cn/app"
            }
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium hover:underline"
          >
            打开飞书应用后台
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App ID" hint="应用后台 → 凭证与基础信息 → App ID。">
            {(id) => (
              <Input
                id={id}
                readOnly={!!b}
                value={form.appId}
                onChange={(e) => update("appId", e.target.value)}
                required
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            label="App Secret"
            hint={`同页复制 App Secret。${b?.hasSecrets ? "已保存的凭证默认隐藏，可以点击右侧按钮查看。" : ""}`}
          >
            {(id) => (
              <SecretInput
                id={id}
                label="App Secret"
                disabled={credentialsLoading || !!credentialsError}
                value={form.appSecret}
                onChange={(e) => update("appSecret", e.target.value)}
                required={!b?.hasSecrets}
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field
            label="验证令牌（Verification Token）"
            hint={`开发配置 → 事件与回调 → 加密策略，复制 Verification Token。${b?.hasSecrets ? "已保存的凭证默认隐藏。" : ""}`}
          >
            {(id) => (
              <SecretInput
                id={id}
                label="Verification Token"
                disabled={credentialsLoading || !!credentialsError}
                value={form.verificationToken}
                onChange={(e) => update("verificationToken", e.target.value)}
                required={!b?.hasSecrets}
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field
            label="消息加密密钥（Encrypt Key）"
            hint={`同一页面复制 Encrypt Key；首次使用时点击生成或刷新按钮。${b?.hasSecrets ? "已保存的凭证默认隐藏。" : ""}`}
          >
            {(id) => (
              <SecretInput
                id={id}
                label="Encrypt Key"
                disabled={credentialsLoading || !!credentialsError}
                value={form.encryptKey}
                onChange={(e) => update("encryptKey", e.target.value)}
                required={!b?.hasSecrets}
                autoComplete="new-password"
              />
            )}
          </Field>
        </div>
        <p className="text-[13px] text-ink-2">
          企业标识会在收到第一条已验证消息时自动记录，不需要填写。保存后，将本页提供的消息接收地址填入飞书的「将事件发送至开发者服务器」。
        </p>
        <Field
          label="技术方案目录链接"
          hint="请使用飞书知识库中的父文档链接。每个任务会在该目录下面创建独立文档。"
        >
          {(id) => (
            <Input
              id={id}
              type="url"
              value={form.wikiUrl}
              onChange={(e) => update("wikiUrl", e.target.value)}
              required
              placeholder="https://你的企业.feishu.cn/wiki/…"
            />
          )}
        </Field>
        <Field
          label="默认项目"
          hint="单聊没有指定项目时使用。未设置时，机器人会询问创建到哪个项目。"
        >
          {() => (
            <Picker
              value={form.defaultProjectId}
              onChange={(value) => update("defaultProjectId", value)}
              ariaLabel="默认项目"
              options={[
                { value: "none", label: "每次选择项目" },
                ...data.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
              ]}
            />
          )}
        </Field>
        <Field
          label="空间通知群"
          hint="可选。网页等入口创建的任务会向这个群发送状态通知；聊天创建的任务仍然回复原聊天。"
        >
          {() => (
            <ChatPicker
              value={form.notificationChatId}
              name={form.notificationChatName}
              onChange={(id, name) =>
                setForm((old) => ({
                  ...old,
                  notificationChatId: id,
                  notificationChatName: name,
                }))
              }
              credentials={{ appId: form.appId, appSecret: form.appSecret }}
              available={!!form.appId && (!!form.appSecret || !!b?.hasSecrets)}
              optional
              ariaLabel="空间通知群"
            />
          )}
        </Field>
        <Checkbox
          checked={form.enabled}
          onChange={(value) => update("enabled", value)}
          label="启用机器人与技术方案记录"
          hint="启用后，当前空间的新任务会先保存技术方案，再开始实现。"
        />
        {error && <InlineError>{error}</InlineError>}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={credentialsLoading || !!credentialsError}
          >
            保存配置
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
