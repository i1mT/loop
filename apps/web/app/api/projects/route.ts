import { requestUserId } from "@/lib/machine-access/request.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { requestSpace } from "@/lib/spaces.ts";
import { createProject, listProjects } from "@/lib/tasks.ts";

export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  return json({ ok: true, projects: await listProjects(archived, requestSpace(req) ?? undefined, requestUserId(req)) });
}

export async function POST(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ name?: string; machineId?: string; bindings?: import("@/lib/routing/bindings.ts").ProjectBinding[]; agent?: string; githubRepo?: string; localPath?: string; mainRef?: string; instructions?: string }>(req);
  if (!body?.name || (!body.machineId && !body.bindings?.length)) return fail(400, "需要 name 和至少一台机器");
  try {
    return json({ ok: true, project: await createProject({ name: body.name, machineId: body.machineId, bindings:body.bindings, agent: body.agent, githubRepo: body.githubRepo, localPath: body.localPath, mainRef: body.mainRef, instructions: body.instructions, spaceId: requestSpace(req) ?? undefined, actorId: requestUserId(req) }) }, 201);
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}
