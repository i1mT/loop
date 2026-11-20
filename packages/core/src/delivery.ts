export interface TestEnvironment {
  url: string;
  username: string;
  password: string;
  workflow: string;
}

export interface DeliverySettings {
  preview: TestEnvironment;
  production: TestEnvironment;
}

export const DELIVERY_STAGES = ["preview_deploy", "preview_test", "production_review", "production_deploy", "production_test"] as const;
export type DeliveryStage = (typeof DELIVERY_STAGES)[number];
export function isDeliveryStage(stage: string): stage is DeliveryStage {
  return DELIVERY_STAGES.some((value) => value === stage);
}

export interface DeploymentRun {
  id: string;
  url: string;
  attempt?: string;
  status: "pending" | "success" | "failed" | "cancelled" | "skipped";
}

export interface ReleaseTask {
  id: string;
  round: number;
  title: string;
  verification?: "passed" | "pending" | "repairing" | "failed";
  testedSha?: string | null;
}

export interface DeliveryRecovery {
  environment: "preview" | "production";
  sha: string;
  runId?: string;
  attempt?: string;
  retryKey?: string;
  sentAt?: number;
  action: "retry" | "repair" | "blocked";
  reason: string;
}

export interface ReleaseRequest {
  number: number;
  url: string;
  head: string;
  tasks: ReleaseTask[];
}

export interface DeliveryState {
  previewMerge?: string | null;
  includedPreviewMerge?: string;
  repairCount?: number;
  repairReasons?: string[];
  recovery?: DeliveryRecovery[];
  previewSha?: string;
  previewRun?: DeploymentRun | null;
  previewResult?: string;
  previewPassed?: boolean;
  release?: ReleaseRequest | null;
  productionApproval?: string | null;
  productionMerge?: string;
  productionSha?: string;
  productionRun?: DeploymentRun | null;
  productionResult?: string;
}
