export interface FeishuBinding {
  id: string;
  appId: string;
  tenantKey: string;
  tenantVerified?: boolean;
  callbackVerifiedAt?: number | null;
  lastEventAt?: number | null;
  tenantMismatchAt?: number | null;
  tenantMismatchKey?: string | null;
  wikiUrl: string;
  defaultProjectId: string | null;
  notificationChatId: string | null;
  notificationChatName?: string | null;
  enabled: boolean;
  hasSecrets: boolean;
  callbackUrl: string;
}
export interface FeishuSettings {
  binding: FeishuBinding | null;
  routes: {
    chatId: string;
    chatName?: string | null;
    projectId: string;
    enabled: boolean;
  }[];
  identities: { openId: string; userId: string; name: string }[];
  jobs: {
    id: string;
    kind: string;
    state: string;
    error: string | null;
    attempts: number;
    createdAt: number;
  }[];
  projects: { id: string; name: string }[];
  canManage: boolean;
  linked: boolean;
}
