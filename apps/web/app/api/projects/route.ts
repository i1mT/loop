import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { requestSpace } from "@/lib/spaces.ts";
import { createProject, listProjects } from "@/lib/tasks.ts";

export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  return json({ ok: true, projects: await listProjects(archived, requestSpace(req) ?? undefined) });
}

export async function POST(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ name?: string; machineId?: string; agent?: string; githubRepo?: string; localPath?: string; mainRef?: string; instructions?: string }>(req);
  if (!body?.name || !body.machineId || !body.agent) return fail(400, "需要 name、machineId、agent");
  try {
    return json({ ok: true, project: await createProject({ name: body.name, machineId: body.machineId, agent: body.agent, githubRepo: body.githubRepo, localPath: body.localPath, mainRef: body.mainRef, instructions: body.instructions, spaceId: requestSpace(req) ?? undefined }) }, 201);
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}
