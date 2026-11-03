export interface FeishuBinding {
  id: string;
  appId: string;
  tenantKey: string;
  wikiUrl: string;
  defaultProjectId: string | null;
  notificationChatId: string | null;
  enabled: boolean;
  hasSecrets: boolean;
  callbackUrl: string;
}
export interface FeishuSettings {
  binding: FeishuBinding | null;
  routes: { chatId: string; projectId: string; enabled: boolean }[];
  identities: { openId: string; userId: string; name: string }[];
  jobs: { id: string; kind: string; state: string; error: string | null; attempts: number; createdAt: number }[];
  projects: { id: string; name: string }[];
  canManage: boolean;
  linked: boolean;
}
