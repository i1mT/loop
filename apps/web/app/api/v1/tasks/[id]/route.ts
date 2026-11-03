import { fail, json } from "@/lib/http.ts";
import { REPORTER_LABEL } from "@/lib/integrations.ts";
import { projectFromApiKey } from "@/lib/project-key-auth.ts";
import { getTask } from "@/lib/tasks.ts";

// 查询通过 API 推送的任务进度：只能查自己项目的任务
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await projectFromApiKey(req);
  if (!auth) return fail(401, "API 密钥无效或已撤销");
  const t = await getTask((await params).id);
  if (!t || t.project_id !== auth.projectId) return fail(404, "任务不存在");
  return json({ ok: true, task: { id: t.id, title: t.title, stage: t.stage, label: REPORTER_LABEL[t.stage] ?? "处理中", pr_url: t.pr_url, updated_at: t.updated_at, url: `${new URL(req.url).origin}/tasks/${t.id}` } });
}
