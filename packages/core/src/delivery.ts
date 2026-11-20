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
  status: "pending" | "success" | "failed" | "cancelled" | "skipped";
}

export interface ReleaseRequest {
  number: number;
  url: string;
  head: string;
  tasks: { id: string; round: number; title: string }[];
}

export interface DeliveryState {
  previewMerge?: string | null;
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
