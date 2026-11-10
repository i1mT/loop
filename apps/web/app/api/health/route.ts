// 健康检查：给容器编排与负载均衡用。不返回任何业务数据，只确认进程能连上数据库。
import { getDb } from "@/lib/db.ts";

export async function GET() {
  try {
    const db = await getDb();
    await db.prepare("SELECT 1").first();
    return Response.json({ ok: true });
  } catch {
    // 不把数据库错误原文返回给未认证请求。
    return Response.json({ ok: false }, { status: 503 });
  }
}
