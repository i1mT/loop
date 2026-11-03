import { flushPool } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { fail, json, requireRole } from "@/lib/http.ts";

// 立即处理：池里现有的全部反馈合成一个任务（不足 N 条也行；只有一条就是普通任务）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  try {
    const task = await flushPool(await getDb(), (await params).id);
    return task ? json({ ok: true, task }, 201) : fail(409, "池里没有等待合并的反馈");
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}
