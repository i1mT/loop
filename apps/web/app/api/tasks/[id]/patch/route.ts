import { fail, json, readJson, authRole } from "@/lib/http.ts";
import { validateAgentPatch } from "@/lib/attributes.ts";

// 智能体（守护进程令牌）提交的补丁：含属性键一律整体拒绝。
// 人类（管理员令牌）修改属性不走这里，属性只在创建任务时定。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const role = await authRole(req);
  if (!role) return fail(401, "未认证");
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return fail(400, "需要 JSON 补丁");
  if (role === "daemon") {
    const r = validateAgentPatch({ actor: "agent", taskId: id }, body);
    if (!r.ok) return fail(403, `属性只读，智能体不能修改：${r.rejected.join(", ")}`, { rejected: r.rejected });
    return json({ ok: true, applied: [] });
  }
  return fail(400, "管理员修改属性请在创建任务时指定，或使用后续的属性接口");
}
