// 前端使用的接口返回形状（与 /api/* 一致）
import type { Stage } from "@loop/core";

export interface TaskItem {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  body: string;
  agent: string;
  model: string | null;
  effort: string | null;
  machine_id: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  source: string | null;
  source_ref: string | null;
  stage: Stage;
  release_review: number;
  plan_review: number;
  priority: "low" | "normal" | "urgent";
  error: string | null;
  head_sha: string | null;
  approved_sha: string | null;
  /** PR 合并提交；有值说明代码已经进主分支，恢复时应重试发布而不是重建 PR */
  merge_sha?: string | null;
  merged_at?: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  /** 这个任务由几条反馈合成（列表接口才带；1 表示普通任务） */
  feedback_count?: number;
}

/** 一条反馈：提交者的原始内容；多条反馈可以合成一个任务 */
export interface FeedbackItem {
  id: string;
  project_id: string;
  source: string;
  source_ref: string | null;
  title: string;
  body: string;
  scale: "tiny" | "small" | "medium" | "large" | null;
  scale_confidence: number | null;
  state: "pooled" | "linked" | "withdrawn";
  task_id: string | null;
  created_at: number;
}

/** 项目的“等待合并”池 */
export interface PoolItem {
  enabled: boolean;
  size: number;
  maxScale: "tiny" | "small" | "medium" | "large";
  items: { id: string; title: string; source: string; scale: FeedbackItem["scale"]; created_at: number }[];
}

export interface ProjectItem {
  canManage?: boolean;
  bindings?: import("./routing/bindings.ts").ProjectBinding[];
  id: string;
  name: string;
  main_ref: string;
  github_repo: string | null;
  machine_id: string | null;
  agent: string | null;
  local_path: string | null;
  instructions: string | null;
  archived_at: number | null;
  created_at: number;
}

export interface MachineAgent {
  kind: string;
  installed: boolean;
  version: string | null;
  acp: boolean;
  note: string | null;
  models: { value: string; name: string }[];
  efforts: { value: string; name: string }[];
  modelsAt: number | null;
  probePending: boolean;
  probeError: string | null;
  /** 在机器页为该智能体配置的默认模型与思考程度，之后创建的任务使用 */
  defaultModel: string | null;
  defaultEffort: string | null;
}

export interface MachineItem {
  ownerId: string | null;
  owned: boolean;
  shared: boolean;
  legacyAuth: boolean;
  id: string;
  name: string;
  os: string | null;
  version: string | null;
  lastSeen: number;
  online: boolean;
  agents: MachineAgent[];
}

/** 智能体能否被绑定：已安装且能被协议驱动 */
export const agentUsable = (a: MachineAgent) => a.installed && a.acp;

/** 全局“等待合并”：所有项目池里的反馈 */
export interface GlobalPool {
  enabled: boolean;
  size: number;
  maxScale: "tiny" | "small" | "medium" | "large";
  items: { id: string; project_id: string; project_name: string; title: string; source: string; scale: FeedbackItem["scale"]; preview: string; created_at: number }[];
}
