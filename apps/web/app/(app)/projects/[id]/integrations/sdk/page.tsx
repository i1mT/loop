"use client";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { IntegrationBack } from "@/components/project/integration-back.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { SaveBar } from "@/components/project/save-bar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CopyBlock } from "@/components/ui/copy-block.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Checkbox, Field, Textarea } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPatch, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { buildIntegrationDoc } from "@/lib/integration-doc.ts";

interface Sdk {
  key: string;
  allowedOrigins: string;
  enabled: boolean;
  identitySecret: string;
}

export default function SdkIntegration() {
  const { project } = useProjectCtx();
  const toast = useToast();
  const path = `/api/projects/${project.id}/sdk`;
  const sdk = useApi<{ sdk: Sdk }>(path);
  const status = useApi<{ base: string }>("/api/status");
  const base = status.data?.base ?? "https://你的网关地址";
  const s = sdk.data?.sdk;

  const [origins, setOrigins] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [rotate, setRotate] = useState<null | "key" | "identity">(null);
  const [rotateBusy, setRotateBusy] = useState(false);
  useEffect(() => {
    if (s) {
      setOrigins(s.allowedOrigins);
      setEnabled(s.enabled);
    }
  }, [s?.allowedOrigins, s?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sdk.error && !sdk.data) return <ErrorState message={sdk.error.message} onRetry={sdk.reload} />;
  if (!s)
    return (
      <div role="status" aria-label="加载中" className="grid gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-48" />
      </div>
    );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPatch(path, { allowedOrigins: origins, enabled });
      mutate(path);
      toast("ok", "已保存");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function doRotate(what: "key" | "identity") {
    setRotateBusy(true);
    try {
      await apiPost(path, { rotate: what });
      mutate(path);
      toast("ok", what === "key" ? "公钥已重新生成，请更新网站里的 data-key" : "身份密钥已重新生成，请更新接入方后端的环境变量");
      setRotate(null);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setRotateBusy(false);
    }
  }

  const snippet = `<script src="${base}/sdk.js" data-key="${s.key}" async></script>`;
  const doc = buildIntegrationDoc({ base, key: s.key, projectName: project.name, allowedOrigins: s.allowedOrigins || null });

  return (
    <>
      <IntegrationBack projectId={project.id} title="SDK 接入" />

      <Card className="mb-6 p-4">
        <h3 className="text-[15px] font-semibold">嵌入网站</h3>
        <p className="mb-3 mt-1 text-[13px] text-ink-2">把这行放进网站每个页面都会加载的位置（越靠前越好，才能抓到页面加载早期的报错）。页面右下角会出现“反馈”按钮。</p>
        <CopyBlock text={snippet} />
        <p className="mt-3 text-xs text-ink-2">
          公钥 <span className="num">{s.key}</span> 可以公开，写进前端没问题；真正的访问控制靠下面的“允许的站点”。想用自己的入口按钮，用代码初始化：<span className="num">LoopFeedback.init({"{ key, hideButton: true }"})</span>，再调用 <span className="num">LoopFeedback.open()</span>。
        </p>
      </Card>

      <Card className="mb-6">
        <h3 className="border-b border-line px-4 py-3 text-[15px] font-semibold">允许的站点</h3>
        <form onSubmit={save} className="grid gap-4 p-4 sm:max-w-2xl">
          <Field label="站点白名单" hint="每行一个，形如 https://app.example.com 或 https://*.example.com。留空表示任何站点都能提交（不建议）。">
            {(id) => <Textarea id={id} value={origins} onChange={(e) => setOrigins(e.target.value)} rows={4} spellCheck={false} placeholder="https://app.example.com" />}
          </Field>
          <Checkbox checked={enabled} onChange={setEnabled} label="启用 SDK 接入" hint="关闭后，所有网站的提交都会被拒绝" />
          <SaveBar busy={busy} dirty={origins !== s.allowedOrigins || enabled !== s.enabled} error={error} />
        </form>
      </Card>

      <Card className="mb-6 p-4">
        <h3 className="text-[15px] font-semibold">身份识别（可选）</h3>
        <p className="mb-3 mt-1 max-w-2xl text-[13px] text-ink-2">网站有登录体系时，让网站的后端用下面的密钥给登录用户签发一个 JWT（HS256），前端调用 <span className="num">LoopFeedback.setIdentity(token)</span>。验证通过的提交会显示提交者身份，管理员的反馈会被优先处理；没有令牌或令牌无效的一律按普通访客处理。密钥只放在网站后端的环境变量里。</p>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <CopyBlock text={reveal ? s.identitySecret : "•".repeat(32)} copy={s.identitySecret} />
          </div>
          <Button size="sm" variant="ghost" onClick={() => setReveal(!reveal)} aria-label={reveal ? "隐藏密钥" : "显示密钥"}>
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </Card>

      <Card className="mb-6 p-4">
        <h3 className="text-[15px] font-semibold">给 AI 的接入说明</h3>
        <p className="mb-3 mt-1 text-[13px] text-ink-2">自包含的接入步骤，复制给负责改网站代码的 AI（或同事），它就能照着接入并自检。不包含身份密钥。</p>
        <details className="rounded-control border border-line">
          <summary className="cursor-pointer px-3 py-2 text-[13px] hover:bg-canvas/60">展开查看与复制</summary>
          <div className="border-t border-line p-3">
            <CopyBlock text={doc} className="max-h-96 overflow-y-auto" />
          </div>
        </details>
      </Card>

      <Card className="p-4">
        <h3 className="text-[15px] font-semibold">重新生成</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-control border border-line p-3">
            <p className="text-[13px] font-medium">公钥</p>
            <p className="mb-2 mt-0.5 text-xs text-ink-2">泄露到不该用的站点，或想让旧的嵌入失效时使用。旧公钥立即失效，要更换网站里的 data-key。</p>
            <Button size="sm" variant="danger" onClick={() => setRotate("key")}>
              <RefreshCw className="size-3.5" aria-hidden />
              重新生成公钥
            </Button>
          </div>
          <div className="rounded-control border border-line p-3">
            <p className="text-[13px] font-medium">身份密钥</p>
            <p className="mb-2 mt-0.5 text-xs text-ink-2">怀疑密钥泄露时使用。旧密钥签发的令牌立即无效，要更换网站后端的环境变量。</p>
            <Button size="sm" variant="danger" onClick={() => setRotate("identity")}>
              <RefreshCw className="size-3.5" aria-hidden />
              重新生成身份密钥
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={!!rotate} onOpenChange={(v) => !v && setRotate(null)} title={rotate === "key" ? "重新生成公钥？" : "重新生成身份密钥？"} description="旧的立即失效，使用旧值的网站或后端需要同步更换。">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRotate(null)}>取消</Button>
          <Button variant="danger" loading={rotateBusy} onClick={() => rotate && doRotate(rotate)}>
            确认重新生成
          </Button>
        </div>
      </Dialog>
    </>
  );
}
