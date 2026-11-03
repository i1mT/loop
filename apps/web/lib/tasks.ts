// 任务：创建时一次定好全部属性；之后智能体只读（见 @loop/core 的 validateAgentPatch）。
import type { Stage } from "@loop/core";
import { getDb, newId, now } from "./db.ts";
import { getAgentConfig, validateBinding } from "./machines.ts";
import { DEFAULT_SPACE_ID, linkMachine } from "./spaces.ts";
import { nextTaskStage, type SessionState } from "./session-stage.ts";
import { taskPlanInitialization } from "./task-plan/service.ts";
import { canArchive, canEditBody, canRestart } from "./status.ts";

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  body: string;
  agent: string;
  /** 创建时固定：模型与思考程度（空表示智能体默认） */
  model: string | null;
  effort: string | null;
  /** 任务从哪里来：sdk、api；手动创建为空 */
  source: string | null;
  /** 来源的附加信息（JSON）：提交者、页面、外部引用等 */
  source_ref: string | null;
  /** 创建时固定：只有这台机器的守护进程能领取 */
  machine_id: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  stage: Stage;
  release_review: number;
  plan_review: number;
  batch_eligible: number;
  preview_slot: string | null;
  priority: "low" | "normal" | "urgent";
  error: string | null;
  head_sha: string | null;
  approved_sha: string | null;
  plan_approved: number;
  /** 第几轮：发布后继续迭代一次加一（同一个会话，新的 PR） */
  round: number;
  /** 归档时间；非空表示已归档（默认列表不显示） */
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  /** 旧字段（本机路径），由 local_path 取代 */
  repo_path: string | null;
  main_ref: string;
  default_agent: string;
  github_repo: string | null;
  /** 绑定的机器与智能体：任务只会被这台机器领取，由这个智能体执行 */
  machine_id: string | null;
  agent: string | null;
  /** 绑定机器上的已有检出路径；为空则由守护进程在自己的数据目录里克隆 */
  local_path: string | null;
  /** 项目全局指令：任务开始时与任务内容一起发给智能体 */
  instructions: string | null;
  archived_at: number | null;
  /** 所属空间。任务、反馈都跟着项目走。 */
  space_id: string | null;
  created_at: number;
}

export const INSTRUCTIONS_MAX = 8000;

export interface NewProjectInput {
  name: string;
  machineId: string;
  agent: string;
  githubRepo?: string | null;
  localPath?: string | null;
  mainRef?: string;
  instructions?: string | null;
  /** 不传则归到默认空间（测试与脚本） */
  spaceId?: string;
}

export async function createProject(
  input: NewProjectInput,
): Promise<ProjectRow> {
  const db = await getDb();
  const err = await validateBinding(db, input.machineId, input.agent);
  if (err) throw new Error(err);
  if ((input.instructions ?? "").length > INSTRUCTIONS_MAX)
    throw new Error(`全局指令最长 ${INSTRUCTIONS_MAX} 字`);
  if (
    !input.githubRepo ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.githubRepo)
  ) {
    throw new Error(
      "需要 GitHub 仓库（格式 owner/name）：所有改动都通过分支和 PR 进入主分支",
    );
  }
  const row: ProjectRow = {
    id: newId(),
    name: input.name,
    repo_path: null,
    main_ref: input.mainRef ?? "main",
    default_agent: input.agent,
    github_repo: input.githubRepo ?? null,
    machine_id: input.machineId,
    agent: input.agent,
    local_path: input.localPath ?? null,
    instructions: input.instructions?.trim() || null,
    archived_at: null,
    space_id: input.spaceId ?? DEFAULT_SPACE_ID,
    created_at: now(),
  };
  await db
    .prepare(
      `INSERT INTO projects (id, name, repo_path, main_ref, default_agent, github_repo, machine_id, agent, local_path, instructions, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.name,
      row.repo_path,
      row.main_ref,
      row.default_agent,
      row.github_repo,
      row.machine_id,
      row.agent,
      row.local_path,
      row.instructions,
      row.space_id,
      row.created_at,
    )
    .run();
  await linkMachine(db, row.space_id!, row.machine_id!);
  return row;
}

export interface ProjectPatch {
  name?: string;
  machineId?: string;
  agent?: string;
  instructions?: string | null;
  mainRef?: string;
  localPath?: string | null;
  githubRepo?: string;
}

/**
 * 修改项目设置。只改给出的字段。项目只选择“哪台机器的哪个智能体”，模型与思考程度在机器页的智能体里配置。
 * 已经创建的任务不受影响（任务的机器、智能体、模型、思考程度在创建时就定了）。
 */
export async function updateProject(
  id: string,
  patch: ProjectPatch,
): Promise<ProjectRow> {
  const db = await getDb();
  const cur = await getProject(id);
  if (!cur) throw new Error("项目不存在");
  const machineId = patch.machineId ?? cur.machine_id!;
  const agent = patch.agent ?? cur.agent!;
  if (machineId !== cur.machine_id || agent !== cur.agent) {
    const err = await validateBinding(db, machineId, agent);
    if (err) throw new Error(err);
  }
  const instructions =
    "instructions" in patch
      ? patch.instructions?.trim() || null
      : cur.instructions;
  if ((instructions ?? "").length > INSTRUCTIONS_MAX)
    throw new Error(`全局指令最长 ${INSTRUCTIONS_MAX} 字`);
  const githubRepo = patch.githubRepo ?? cur.github_repo;
  if (!githubRepo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo))
    throw new Error("GitHub 仓库格式应为 owner/name");
  const name = patch.name?.trim() || cur.name;
  await db
    .prepare(
      `UPDATE projects SET name=?, machine_id=?, agent=?, default_agent=?, instructions=?, main_ref=?, local_path=?, github_repo=? WHERE id=?`,
    )
    .bind(
      name,
      machineId,
      agent,
      agent,
      instructions,
      patch.mainRef?.trim() || cur.main_ref,
      "localPath" in patch ? patch.localPath?.trim() || null : cur.local_path,
      githubRepo,
      id,
    )
    .run();
  if (cur.space_id) await linkMachine(db, cur.space_id, machineId);
  return (await getProject(id))!;
}

/** archived：false 只列未归档（默认），true 只列已归档 */
export async function listProjects(
  archived = false,
  spaceId?: string,
): Promise<ProjectRow[]> {
  const db = await getDb();
  const space = spaceId ? " AND space_id=?" : "";
  return (
    await db
      .prepare(
        `SELECT * FROM projects WHERE archived_at IS ${archived ? "NOT NULL" : "NULL"}${space} ORDER BY created_at DESC`,
      )
      .bind(...(spaceId ? [spaceId] : []))
      .all<ProjectRow>()
  ).results;
}

/** 归档项目：停止接收新任务（手动、SDK、API 都会被拒绝），已有任务不受影响；可恢复 */
export async function setProjectArchived(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  if (!(await getProject(id))) return { ok: false, error: "项目不存在" };
  await db
    .prepare(`UPDATE projects SET archived_at=? WHERE id=?`)
    .bind(archived ? now() : null, id)
    .run();
  return { ok: true };
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const db = await getDb();
  return db
    .prepare(`SELECT * FROM projects WHERE id=?`)
    .bind(id)
    .first<ProjectRow>();
}

export interface NewTaskInput {
  projectId: string;
  title: string;
  body?: string;
  /** 属性：创建时定好，智能体只读 */
  releaseReview?: boolean;
  planReview?: boolean;
  batchEligible?: boolean;
  previewSlot?: string | null;
  priority?: "low" | "normal" | "urgent";
  /** 覆盖项目默认：必须是项目绑定机器上可用的智能体。模型与思考程度取该智能体的配置。 */
  agent?: string;
  /** 来自哪个接入方式（sdk、api、batch=多条反馈合并而成）及其附加信息；手动创建不填 */
  source?: "sdk" | "api" | "batch" | "feishu";
  sourceRef?: Record<string, unknown>;
}

/** 项目能否接收新任务（手动、SDK、API、合并都走这里）。返回已确认可用的项目 */
export async function requireOpenProject(
  projectId: string,
): Promise<ProjectRow & { machine_id: string; agent: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error("项目不存在");
  if (project.archived_at) throw new Error("项目已归档，不再接收新任务");
  if (!project.machine_id || !project.agent)
    throw new Error("项目还没有绑定机器和智能体");
  return project as ProjectRow & { machine_id: string; agent: string };
}

export async function createTask(
  input: NewTaskInput,
  options: {
    id?: string;
    statements?: import("./pg.ts").Statement[];
    claim?: { token: string; count: number };
  } = {},
): Promise<TaskRow> {
  const db = await getDb();
  const project = await requireOpenProject(input.projectId);
  // 智能体：任务指定的优先，否则用项目绑定的；模型与思考程度取这台机器上该智能体当前的配置（创建时记录下来）
  const agent = input.agent || project.agent;
  if (agent !== project.agent) {
    const err = await validateBinding(db, project.machine_id, agent);
    if (err) throw new Error(err);
  }
  const { model, effort } = await getAgentConfig(db, project.machine_id, agent);
  const t = now();
  const row: TaskRow = {
    id: options.id ?? newId(),
    project_id: input.projectId,
    title: input.title,
    body: input.body ?? "",
    agent,
    model,
    effort,
    source: input.source ?? null,
    source_ref: input.sourceRef ? JSON.stringify(input.sourceRef) : null,
    machine_id: project.machine_id,
    branch: null,
    pr_number: null,
    pr_url: null,
    stage: "queued",
    release_review: input.releaseReview === false ? 0 : 1,
    plan_review: input.planReview ? 1 : 0,
    batch_eligible: input.batchEligible ? 1 : 0,
    preview_slot: input.previewSlot ?? null,
    priority: input.priority ?? "normal",
    error: null,
    head_sha: null,
    approved_sha: null,
    plan_approved: 0,
    round: 1,
    archived_at: null,
    created_at: t,
    updated_at: t,
  };
  const insertTask = db
    .prepare(
      `INSERT INTO tasks (id, project_id, title, body, agent, model, effort, source, source_ref, machine_id, stage, release_review, plan_review, batch_eligible, preview_slot, priority, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${options.claim ? "WHERE (SELECT COUNT(*) FROM feedbacks WHERE task_id=?)=?" : ""} ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      row.id,
      row.project_id,
      row.title,
      row.body,
      row.agent,
      row.model,
      row.effort,
      row.source,
      row.source_ref,
      row.machine_id,
      row.stage,
      row.release_review,
      row.plan_review,
      row.batch_eligible,
      row.preview_slot,
      row.priority,
      row.created_at,
      row.updated_at,
      ...(options.claim ? [options.claim.token, options.claim.count] : []),
    );
  await db.batch([
    insertTask,
    taskPlanInitialization(db, row.id, row.project_id, 1),
    ...(options.statements ?? []),
  ]);
  const created = await getTask(row.id);
  if (!created) throw new Error("合并批次已经由其他执行者接管，请重试");
  return created;
}

/** archived：false 只列未归档（默认），true 只列已归档 */
export async function listTasks(
  limit = 100,
  archived = false,
  spaceId?: string,
): Promise<(TaskRow & { project_name: string; feedback_count: number })[]> {
  const db = await getDb();
  const space = spaceId ? " AND p.space_id=?" : "";
  return (
    await db
      .prepare(
        `SELECT t.*, p.name AS project_name, (SELECT COUNT(*) FROM feedbacks f WHERE f.task_id = t.id)::int AS feedback_count FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.archived_at IS ${archived ? "NOT NULL" : "NULL"}${space} ORDER BY t.created_at DESC LIMIT ?`,
      )
      .bind(...(spaceId ? [spaceId, limit] : [limit]))
      .all<TaskRow & { project_name: string; feedback_count: number }>()
  ).results;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const db = await getDb();
  return db.prepare(`SELECT * FROM tasks WHERE id=?`).bind(id).first<TaskRow>();
}

/** 按状态机推进任务阶段；不合法的转换不写入，返回是否被拒绝 */
export async function applySessionState(
  taskId: string,
  state: SessionState,
): Promise<{ stage: Stage; rejected: boolean }> {
  const db = await getDb();
  const task = await getTask(taskId);
  if (!task) return { stage: "failed", rejected: true };
  const r = nextTaskStage(task.stage, state);
  if (r.stage !== task.stage) {
    await db
      .prepare(`UPDATE tasks SET stage=?, updated_at=? WHERE id=?`)
      .bind(r.stage, now(), taskId)
      .run();
  }
  return r;
}

export async function setStage(taskId: string, stage: Stage): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`UPDATE tasks SET stage=?, updated_at=? WHERE id=?`)
    .bind(stage, now(), taskId)
    .run();
}

export async function notify(
  taskId: string,
  kind: string,
  body: string,
): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO notifications (task_id, kind, body, created_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(taskId, kind, body, now())
    .run();
}

export const TITLE_MAX = 200;
export const BODY_MAX = 20000;

/** 修改任务的标题与正文。正文只在任务还没开始时可改（智能体拿到的是创建时的内容）。 */
export async function updateTask(
  id: string,
  patch: { title?: string; body?: string },
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(id);
  if (!task) return { ok: false, error: "任务不存在" };
  if (task.archived_at) return { ok: false, error: "任务已归档，请先恢复" };
  const title = patch.title === undefined ? task.title : patch.title.trim();
  if (!title || title.length > TITLE_MAX)
    return { ok: false, error: `标题必填，最长 ${TITLE_MAX} 字` };
  const bodyChanged = patch.body !== undefined && patch.body !== task.body;
  if (bodyChanged) {
    if (!canEditBody(task.stage))
      return {
        ok: false,
        error: "任务已经开始，不能再改正文；想调整要求请在会话里回复",
      };
    if (patch.body!.length > BODY_MAX)
      return { ok: false, error: `正文最长 ${BODY_MAX} 字` };
  }
  const db = await getDb();
  await db
    .prepare(`UPDATE tasks SET title=?, body=?, updated_at=? WHERE id=?`)
    .bind(title, bodyChanged ? patch.body! : task.body, now(), id)
    .run();
  return { ok: true };
}

/** 归档任务：只有已结束的任务可以归档；恢复随时可以 */
export async function setTaskArchived(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(id);
  if (!task) return { ok: false, error: "任务不存在" };
  if (archived && !canArchive(task.stage))
    return { ok: false, error: "任务还没有结束，请先取消或等它完成再归档" };
  const db = await getDb();
  await db
    .prepare(`UPDATE tasks SET archived_at=? WHERE id=?`)
    .bind(archived ? now() : null, id)
    .run();
  return { ok: true };
}

/** 用失败/驳回/取消任务的内容新建一个任务（旧任务保持原样，保留它的 PR 与会话记录） */
export async function restartTask(
  id: string,
): Promise<{ ok: boolean; error?: string; task?: TaskRow }> {
  const old = await getTask(id);
  if (!old) return { ok: false, error: "任务不存在" };
  if (!canRestart(old.stage))
    return { ok: false, error: "只有失败、驳回或取消的任务可以重新开始" };
  try {
    const task = await createTask({
      projectId: old.project_id,
      title: old.title,
      body: old.body,
      releaseReview: !!old.release_review,
      planReview: !!old.plan_review,
      batchEligible: !!old.batch_eligible,
      priority: old.priority,
      agent: old.agent,
      source: (old.source as "sdk" | "api" | "batch" | null) ?? undefined,
      sourceRef: old.source_ref
        ? {
            ...(JSON.parse(old.source_ref) as Record<string, unknown>),
            restartedFrom: old.id,
          }
        : { restartedFrom: old.id },
    });
    // 反馈跟着新任务走：旧任务已经结束，SDK 里的进度应该跟踪重新开始后的这一个
    await (
      await getDb()
    )
      .prepare(`UPDATE feedbacks SET task_id=?, updated_at=? WHERE task_id=?`)
      .bind(task.id, now(), old.id)
      .run();
    return { ok: true, task };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
