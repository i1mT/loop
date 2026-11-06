import type { Db } from "../pg.ts";
import { seal, unseal } from "./crypto.ts";
export interface FeishuSecrets {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
}
export interface Binding {
  id: string;
  space_id: string;
  app_id: string;
  tenant_key: string;
  secrets: string;
  wiki_url: string;
  default_project_id: string | null;
  notification_chat_id: string | null;
  notification_chat_name?: string | null;
  callback_verified_at?: number | null;
  tenant_verified_at?: number | null;
  last_event_at?: number | null;
  tenant_mismatch_at?: number | null;
  tenant_mismatch_key?: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}
export interface BindingInput {
  appId: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  /** 兼容旧客户端；企业归属由已验证事件自动记录，不接受手动覆盖。 */
  tenantKey?: string;
  wikiUrl: string;
  defaultProjectId?: string | null;
  notificationChatId?: string | null;
  notificationChatName?: string | null;
  enabled: boolean;
}
export function wikiToken(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("请填写知识库目录的完整链接");
  }
  if (
    parsed.protocol !== "https:" ||
    !/(^|\.)feishu\.cn$/.test(parsed.hostname)
  )
    throw new Error("请使用飞书知识库链接");
  const token = /^\/wiki\/([A-Za-z0-9]+)/.exec(parsed.pathname)?.[1];
  if (!token)
    throw new Error("请选择知识库中的父文档；普通独立文档不能创建子文档");
  return token;
}
export async function getBinding(
  db: Db,
  spaceId: string,
): Promise<Binding | null> {
  return db
    .prepare("SELECT * FROM space_feishu_bindings WHERE space_id=?")
    .bind(spaceId)
    .first<Binding>();
}
export async function getBindingById(
  db: Db,
  id: string,
): Promise<Binding | null> {
  return db
    .prepare("SELECT * FROM space_feishu_bindings WHERE id=?")
    .bind(id)
    .first<Binding>();
}
export async function getBindingSecrets(
  db: Db,
  id: string,
  key: string,
): Promise<FeishuSecrets> {
  const binding = await getBindingById(db, id);
  if (!binding) throw new Error("机器人尚未绑定");
  return unseal<FeishuSecrets>(binding.secrets, key, binding.id);
}
export async function saveBinding(
  db: Db,
  spaceId: string,
  input: BindingInput,
  key: string,
): Promise<Binding> {
  const previous = await getBinding(db, spaceId);
  const id = previous?.id ?? crypto.randomUUID();
  if (!/^cli_[A-Za-z0-9]+$/.test(input.appId))
    throw new Error("请从企业自建应用的「凭证与基础信息」复制正确的 App ID");
  wikiToken(input.wikiUrl);
  if (previous && previous.app_id !== input.appId)
    throw new Error("更换应用需要新建空间绑定，避免把旧任务发送到其他机器人");
  const old = previous ? await getBindingSecrets(db, id, key) : null;
  const secrets = {
    appId: input.appId,
    appSecret: input.appSecret?.trim() || old?.appSecret || "",
    verificationToken:
      input.verificationToken?.trim() || old?.verificationToken || "",
    encryptKey: input.encryptKey?.trim() || old?.encryptKey || "",
  };
  if (!secrets.appSecret || !secrets.verificationToken || !secrets.encryptKey)
    throw new Error("请填写应用密钥、验证令牌和事件加密密钥");
  if (input.defaultProjectId) {
    const project = await db
      .prepare(
        "SELECT id FROM projects WHERE id=? AND space_id=? AND archived_at IS NULL",
      )
      .bind(input.defaultProjectId, spaceId)
      .first();
    if (!project) throw new Error("默认项目不属于当前空间或已归档");
  }
  const notificationChatId = input.notificationChatId?.trim() || null;
  if (notificationChatId && !/^oc_[A-Za-z0-9]+$/.test(notificationChatId))
    throw new Error("请选择机器人已经加入的通知群");
  const notificationChatName = notificationChatId
    ? input.notificationChatName?.trim().slice(0, 120) ||
      (notificationChatId === previous?.notification_chat_id
        ? previous.notification_chat_name
        : null)
    : null;
  const callbackVerifiedAt =
    old &&
    old.verificationToken === secrets.verificationToken &&
    old.encryptKey === secrets.encryptKey
      ? (previous?.callback_verified_at ?? null)
      : null;
  const time = Date.now();
  await db
    .prepare(
      `INSERT INTO space_feishu_bindings(id,space_id,app_id,tenant_key,secrets,wiki_url,default_project_id,notification_chat_id,notification_chat_name,callback_verified_at,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(space_id) DO UPDATE SET secrets=EXCLUDED.secrets,wiki_url=EXCLUDED.wiki_url,default_project_id=EXCLUDED.default_project_id,notification_chat_id=EXCLUDED.notification_chat_id,notification_chat_name=EXCLUDED.notification_chat_name,callback_verified_at=EXCLUDED.callback_verified_at,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at`,
    )
    .bind(
      id,
      spaceId,
      input.appId,
      previous?.tenant_key ?? "",
      await seal(secrets, key, id),
      input.wikiUrl,
      input.defaultProjectId || null,
      notificationChatId,
      notificationChatName,
      callbackVerifiedAt,
      input.enabled ? 1 : 0,
      time,
      time,
    )
    .run();
  return (await getBinding(db, spaceId))!;
}
export function bindingView(binding: Binding, origin: string) {
  return {
    id: binding.id,
    appId: binding.app_id,
    tenantKey: binding.tenant_key,
    tenantVerified: !!binding.tenant_verified_at,
    callbackVerifiedAt: binding.callback_verified_at ?? null,
    lastEventAt: binding.last_event_at ?? null,
    tenantMismatchAt: binding.tenant_mismatch_at ?? null,
    tenantMismatchKey: binding.tenant_mismatch_key ?? null,
    wikiUrl: binding.wiki_url,
    defaultProjectId: binding.default_project_id,
    notificationChatId: binding.notification_chat_id,
    notificationChatName: binding.notification_chat_name ?? null,
    enabled: !!binding.enabled,
    hasSecrets: true,
    callbackUrl: `${origin}/api/feishu/webhook/${binding.id}`,
  };
}
