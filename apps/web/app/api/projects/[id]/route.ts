import { requestUserId } from "@/lib/machine-access/request.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getProject, updateProject, type ProjectPatch } from "@/lib/tasks.ts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const p = await getProject((await params).id,requestUserId(req));
  return p ? json({ ok: true, project: p }) : fail(404, "项目不存在");
}

// 修改项目设置：智能体、模型、思考程度、全局指令、机器、主分支等。只改给出的字段。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<ProjectPatch>(req);
  if (!body) return fail(400, "需要 JSON");
  try {
    await updateProject((await params).id, body, requestUserId(req));
    return json({ok:true,project:await getProject((await params).id,requestUserId(req))});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg === "项目不存在" ? 404 : msg.includes("权限") ? 403 : 400, msg);
  }
}
