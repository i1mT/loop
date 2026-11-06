import { notificationContext } from "./feishu/jobs/context.ts";
import { routingLock } from "./machine-access/policy.ts";
import { readBindings, prepareBindings, bindingWrites, bindingAuthorization, type ProjectBinding } from "./routing/bindings.ts";
import { projectAccessSql, projectManageSql } from "./routing/access.ts";
import { dispatchInsert, dispatchAuthorization } from "./routing/dispatch.ts";
// 任务：创建时一次定好全部属性；之后智能体只读（见 @loop/core 的 validateAgentPatch）。
import type { Stage } from "@loop/core";
import { getDb, newId, now } from "./db.ts";
import { validateBinding } from "./machines.ts";
import { DEFAULT_SPACE_ID, linkMachine } from "./spaces.ts";
import { nextTaskStage, type SessionState } from "./session-stage.ts";
import { taskPlanInitialization } from "./task-plan/service.ts";
import { canArchive, canEditBody, canRestart } from "./status.ts";

export interface TaskRow {
  execution_path?: string | null;
  execution_snapshot?: number;
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
  /** PR 合并提交；有值说明代码已进主分支，恢复时用“重试发布”而不是重建 PR */
  merge_sha: string | null;
  merged_at: number | null;
  plan_approved: number;
  /** 第几轮：发布后继续迭代一次加一（同一个会话，新的 PR） */
  round: number;
  /** 归档时间；非空表示已归档（默认列表不显示） */
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectRow {
  canManage?: boolean;
  bindings?: ProjectBinding[];
  binding_revision?: number;
  dispatch_cursor?: number;
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
  machineId?: string;
  bindings?: ProjectBinding[];
  /** 兼容旧入口：绑定行没有智能体时用它；新入口每行自带智能体 */
  agent?: string;
  githubRepo?: string | null;
  localPath?: string | null;
  mainRef?: string;
  instructions?: string | null;
  /** 不传则归到默认空间（测试与脚本） */
  spaceId?: string;
  actorId?: string | null;
}

export async function createProject(
  input: NewProjectInput,
): Promise<ProjectRow> {
  const db = await getDb();
  const spaceId=input.spaceId ?? DEFAULT_SPACE_ID;
  const fallbackAgent=input.agent?.trim()||"";
  const requested=input.bindings ?? (input.machineId?[{machineId:input.machineId,localPath:input.localPath??null,agent:fallbackAgent}]:[]);
  const bindings=await prepareBindings(db,requested,fallbackAgent,spaceId,input.actorId);
  const first=bindings[0]!;
  const agent=first.agent;
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
    default_agent: agent,
    github_repo: input.githubRepo ?? null,
    machine_id: first.machineId,
    agent,
    local_path: first.localPath,
    instructions: input.instructions?.trim() || null,
    archived_at: null,
    space_id: input.spaceId ?? DEFAULT_SPACE_ID,
    created_at: now(),
  };
  const insert = db
    .prepare(
      `INSERT INTO projects (id, name, repo_path, main_ref, default_agent, github_repo, machine_id, agent, local_path, instructions, space_id, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`,
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

    );
  try {await db.batch([routingLock(db),...bindingAuthorization(db,bindings,spaceId,input.actorId),insert,...bindingWrites(db,row.id,bindings),...bindings.map(binding=>db.prepare(`INSERT INTO space_machines(space_id,machine_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING`).bind(spaceId,binding.machineId,now()))]);}
  catch(error){if((error as {code?:string}).code==='22012')throw new Error("没有这台机器的使用权限");throw error;}
  return {...row,bindings,binding_revision:0};
}

export interface ProjectPatch {
  bindings?: ProjectBinding[];
  name?: string;
  machineId?: string;
  agent?: string;
  instructions?: string | null;
  mainRef?: string;
  localPath?: string | null;
  githubRepo?: string;
}

/**
 * 修改项目设置。只改给出的字段。每台绑定机器各自选择智能体，可选覆盖模型与思考程度（为空跟随机器配置）。
 * 旧客户端的 agent 字段仍兼容：会把它应用到所有绑定机器。已经创建的任务不受影响。
 */
export async function updateProject(
  id: string,
  patch: ProjectPatch,
  actorId?: string | null,
): Promise<ProjectRow> {
  const db = await getDb();
  const cur = await getProject(id);
  if (!cur) throw new Error("项目不存在");
  const fallbackAgent=patch.agent?.trim() || cur.agent || cur.bindings?.find(row=>row.agent)?.agent || "";
  const changed=patch.bindings!==undefined || patch.machineId!==undefined || patch.localPath!==undefined || patch.agent!==undefined;
  let requested:ProjectBinding[];
  if(patch.bindings!==undefined){
    requested=patch.bindings.map(row=>({...row,agent:row.agent||fallbackAgent}));
  }else if(patch.machineId!==undefined){
    requested=[{machineId:patch.machineId,localPath:patch.localPath??null,agent:fallbackAgent,model:null,effort:null},...(cur.bindings??[]).filter(row=>row.machineId!==cur.machine_id&&row.machineId!==patch.machineId)];
  }else{
    requested=(cur.bindings??[]).map((row,index)=>index===0&&patch.localPath!==undefined?{...row,localPath:patch.localPath??null}:row);
    // 旧入口只给 agent：应用到全部绑定；换智能体时清掉属于旧智能体的模型覆盖。
    if(patch.agent!==undefined)requested=requested.map(row=>row.agent===patch.agent?row:{...row,agent:patch.agent!,model:null,effort:null});
  }
  const bindings=changed?await prepareBindings(db,requested,fallbackAgent,cur.space_id!,actorId,cur.bindings):cur.bindings??[];
  const first=bindings[0];
  const machineId=first?.machineId ?? cur.machine_id;
  const agent=first?.agent || fallbackAgent || cur.agent;
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
  const update = db
    .prepare(
      `UPDATE projects SET name=?, machine_id=?, agent=?, default_agent=?, instructions=?, main_ref=?, local_path=?, github_repo=?,binding_revision=binding_revision+1${changed?",dispatch_cursor=0":""} WHERE id=? AND binding_revision=?`,
    )
    .bind(
      name,
      machineId,
      agent,
      agent,
      instructions,
      patch.mainRef?.trim() || cur.main_ref,
      first?.localPath ?? null,
      githubRepo,
      id,
      cur.binding_revision ?? 0,
    );
  // 旧入口的顶层 agent 是项目公共设置；绑定行里的智能体/模型属于那台机器的配置，只按绑定权限检查。
  const legacyAgentChanged=patch.agent!==undefined&&patch.agent!==cur.agent;
  const globalChanged=legacyAgentChanged || githubRepo!==cur.github_repo || name!==cur.name || instructions!==cur.instructions || (patch.mainRef?.trim()||cur.main_ref)!==cur.main_ref;
  const fullAuth=actorId!==undefined&&globalChanged?[db.prepare(`SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=? AND ${projectManageSql()}) THEN 1 ELSE 0 END`).bind(id,actorId)]:[];
  const auth=actorId!==undefined ? [db.prepare(`SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=? AND ${projectAccessSql()}) THEN 1 ELSE 0 END`).bind(id,actorId)] : [];
  // 配置版本守卫失败时回滚，不能用旧绑定集合覆盖其他成员的修改。
  const revision=db.prepare(`SELECT 1/CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=? AND binding_revision=?) THEN 1 ELSE 0 END`).bind(id,cur.binding_revision??0);
  const visibleRequested=changed?requested:[];
  try {await db.batch([routingLock(db),...auth,...fullAuth,revision,...(changed?bindingAuthorization(db,visibleRequested,cur.space_id!,actorId):[]),update,...(changed?bindingWrites(db,id,bindings):[]),...bindings.map(binding=>db.prepare(`INSERT INTO space_machines(space_id,machine_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING`).bind(cur.space_id,binding.machineId,now()))]);}
  catch(error){if((error as {code?:string}).code==='22012')throw new Error("项目配置已变化或没有使用权限，请刷新后重试");throw error;}
  return (await getProject(id))!;
}

/** archived：false 只列未归档（默认），true 只列已归档 */
export async function listProjects(
  archived = false,
  spaceId?: string,
  userId?: string | null,
): Promise<ProjectRow[]> {
  if(userId===null)return [];
  const db = await getDb();
  const space = spaceId ? " AND space_id=?" : "";
  const access = userId !== undefined ? ` AND ${projectAccessSql()}` : "";
  const rows = (
    await db
      .prepare(
        `SELECT * FROM projects WHERE archived_at IS ${archived ? "NOT NULL" : "NULL"}${space}${access} ORDER BY created_at DESC`,
      )
      .bind(...(spaceId ? [spaceId] : []), ...(userId !== undefined ? [userId] : []))
      .all<ProjectRow>()
  ).results;
  return projectViews(db,rows,userId);
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

async function projectViews(db: import("./pg.ts").Db,rows:ProjectRow[],userId?:string|null):Promise<ProjectRow[]> {
  if(!rows.length)return [];
  const all=(await db.prepare(`SELECT b.project_id,b.machine_id,b.local_path,b.agent,b.model,b.effort,b.position,m.id AS exists_id,m.owner_user_id,sm.shared
    FROM project_machines b JOIN projects p ON p.id=b.project_id LEFT JOIN machines m ON m.id=b.machine_id
    LEFT JOIN space_machines sm ON sm.machine_id=m.id AND sm.space_id=p.space_id
    WHERE b.project_id IN (${rows.map(()=>"?").join(",")}) ORDER BY b.position,b.machine_id`).bind(...rows.map(row=>row.id)).all<{project_id:string;machine_id:string;local_path:string|null;agent:string;model:string|null;effort:string|null;exists_id:string|null;owner_user_id:string|null;shared:number|null}>()).results;
  return rows.map(row=>{
    const stored=all.filter(binding=>binding.project_id===row.id);
    const visible=stored.filter(binding=>userId===undefined || (!!userId&&!!binding.exists_id&&(binding.owner_user_id===userId||Number(binding.shared)===1)));
    const bindings=visible.map(binding=>({machineId:binding.machine_id,localPath:binding.local_path,agent:binding.agent,model:binding.model,effort:binding.effort}));
    const first=bindings[0];
    return {...row,bindings,...(userId!==undefined?{machine_id:first?.machineId??null,local_path:first?.localPath??null,repo_path:first?.localPath??null,agent:first?.agent??row.agent,canManage:stored.length>0&&visible.length===stored.length}:{})};
  });
}
export async function getProject(id: string,userId?: string|null): Promise<ProjectRow | null> {
  const db=await getDb();const row=await db.prepare(`SELECT * FROM projects WHERE id=?`).bind(id).first<ProjectRow>();
  return row?(await projectViews(db,[row],userId))[0]:null;
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
  /** 浏览器操作的真实用户；已授权的项目 SDK/API 不传此项。 */
  actorId?: string | null;
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
    actorId?: string | null;
  } = {},
): Promise<TaskRow> {
  const db = await getDb();
  const project = await requireOpenProject(input.projectId);
  const actorId=options.actorId!==undefined?options.actorId:input.actorId;
  const agent=input.agent || project.agent;
  if(input.agent){
    const eligible=await readBindings(db,project.id,actorId);
    const errors=await Promise.all(eligible.map(binding=>validateBinding(db,binding.machineId,agent)));
    if(eligible.length&&errors.every(Boolean))throw new Error(errors[0]!);
  }
  const model=null,effort=null;
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
    merge_sha: null,
    merged_at: null,
    plan_approved: 0,
    round: 1,
    archived_at: null,
    created_at: t,
    updated_at: t,
  };
  const insertTask=dispatchInsert(db,{
    id:row.id,projectId:row.project_id,title:row.title,body:row.body,agent:input.agent,
    source:row.source,sourceRef:row.source_ref,releaseReview:row.release_review,planReview:row.plan_review,
    batchEligible:row.batch_eligible,previewSlot:row.preview_slot,priority:row.priority,at:t,actorId,claim:options.claim,
  });
  try {await db.batch([
    routingLock(db),dispatchAuthorization(db,project.id,input.agent,actorId),insertTask,
    taskPlanInitialization(db,row.id,row.project_id,1),...(options.statements??[]),
  ]);}catch(error){
    if((error as {code?:string}).code==='22012')throw new Error("没有机器使用权限，或绑定机器没有安装所选智能体");
    throw error;
  }
  const created = await getTask(row.id);
  if (!created) throw new Error("合并批次已经由其他执行者接管，请重试");
  return created;
}

/** archived：false 只列未归档（默认），true 只列已归档 */
export async function listTasks(
  limit = 100,
  archived = false,
  spaceId?: string,
  userId?: string | null,
): Promise<(TaskRow & { project_name: string; feedback_count: number })[]> {
  if(userId===null)return [];
  const db = await getDb();
  const space = spaceId ? " AND p.space_id=?" : "";
  const access = userId !== undefined ? ` AND EXISTS (SELECT 1 FROM machines m WHERE m.id=t.machine_id AND (m.owner_user_id=? OR EXISTS (SELECT 1 FROM space_machines sm WHERE sm.machine_id=m.id AND sm.space_id=p.space_id AND sm.shared=1)))` : "";
  return (
    await db
      .prepare(
        `SELECT t.*, p.name AS project_name, (SELECT COUNT(*) FROM feedbacks f WHERE f.task_id = t.id)::int AS feedback_count FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.archived_at IS ${archived ? "NOT NULL" : "NULL"}${space}${access} ORDER BY t.created_at DESC LIMIT ?`,
      )
      .bind(...(spaceId ? [spaceId] : []), ...(userId !== undefined ? [userId] : []), limit)
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

export async function setStage(taskId: string, stage: Stage, detail?: string): Promise<void> {
  const db = await getDb();
  const statement=db.prepare(`UPDATE tasks SET stage=?,updated_at=? WHERE id=?`).bind(stage,now(),taskId);
  await db.batch([...(detail===undefined?[]:[notificationContext(db,taskId,detail)]),statement]);
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
  actorId?: string | null,
): Promise<{ ok: boolean; error?: string; task?: TaskRow }> {
  const old = await getTask(id);
  if (!old) return { ok: false, error: "任务不存在" };
  if (!canRestart(old.stage))
    return { ok: false, error: "只有失败、驳回或取消的任务可以重新开始" };
  try {
    const task = await createTask({
      projectId: old.project_id,
      actorId,
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
