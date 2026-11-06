import type { FeishuSecrets } from "./bindings.ts";
import { digest } from "./crypto.ts";
export class FeishuApiError extends Error {
  readonly code: number;
  constructor(code: number, detail = "") {
    super(describeError(code, detail));
    this.code = code;
  }
}
/** 从飞书返回的说明里取出缺失的权限，让用户知道该申请哪个 scope，而不是只看到错误码。 */
function describeError(code: number, detail: string): string {
  const required = /(?:is required|应用身份权限)[：:]\s*\[([^\]]+)\]/.exec(
    detail,
  )?.[1];
  const scopes = required
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (scopes?.length)
    return `飞书操作失败（错误码 ${code}）：应用缺少权限 ${scopes.join("、")}，请在开放平台申请并发布版本后重试`;
  if (
    /not in (the )?(wiki|space)|不是知识库成员|无权限|permission denied|needs edit permission/i.test(
      detail,
    )
  )
    return `飞书操作失败（错误码 ${code}）：应用没有该知识库或文档的编辑权限，请把应用加入知识库成员并授予「可编辑」，或把父文档的协作者加上这个应用`;
  return `飞书操作失败（错误码 ${code}），请检查应用权限和目录授权`;
}
interface Result<T> {
  code?: number;
  msg?: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
}
export interface WikiNode {
  node_token: string;
  obj_token: string;
  space_id: string;
  title: string;
  obj_type: string;
}
export async function documentClientToken(
  operation: string,
  index: number,
): Promise<string> {
  const hash = await digest(`${operation}:${index}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
interface TextBlock {
  block_type: number;
  [key: string]: unknown;
}
export function markdownBlocks(markdown: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = markdown.split("\n");
  let code: string[] | null = null;
  const rich = (content: string) => ({
    elements: [{ text_run: { content: content || " " } }],
  });
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (code) {
        blocks.push({
          block_type: 14,
          code: {
            ...rich(code.join("\n")),
            style: { language: 1, wrap: true },
          },
        });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        block_type: heading[1].length + 2,
        [`heading${heading[1].length}`]: rich(heading[2]),
      });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ block_type: 12, bullet: rich(bullet[1]) });
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      blocks.push({ block_type: 13, ordered: rich(ordered[1]) });
      continue;
    }
    for (let i = 0; i < Math.max(line.length, 1); i += 1500)
      blocks.push({ block_type: 2, text: rich(line.slice(i, i + 1500)) });
  }
  if (code)
    blocks.push({
      block_type: 14,
      code: { ...rich(code.join("\n")), style: { language: 1, wrap: true } },
    });
  return blocks;
}
export class FeishuClient {
  private credentials: FeishuSecrets;
  private fetchImpl: typeof fetch;
  private token: string | null = null;
  constructor(credentials: FeishuSecrets, fetchImpl: typeof fetch = fetch) {
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
  }
  private async request<T>(
    route: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    authenticated = true,
  ): Promise<T> {
    const token = authenticated ? await this.accessToken() : null;
    const response = await this.fetchImpl(
      `https://open.feishu.cn/open-apis/${route}`,
      {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      },
    );
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 2_000_000) throw new Error("飞书响应超过读取限制");
    const payload = (await response.json()) as Result<T>;
    if (!response.ok || payload.code)
      throw new FeishuApiError(
        payload.code ?? response.status,
        typeof payload.msg === "string" ? payload.msg : "",
      );
    return (payload.data ?? payload) as T;
  }
  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const payload = await this.request<{ tenant_access_token: string }>(
      "auth/v3/tenant_access_token/internal",
      {
        app_id: this.credentials.appId,
        app_secret: this.credentials.appSecret,
      },
      "POST",
      false,
    );
    if (!payload.tenant_access_token) throw new Error("飞书未返回应用访问凭据");
    this.token = payload.tenant_access_token;
    return this.token;
  }
  async listChats(
    pageToken?: string,
  ): Promise<{
    chats: { id: string; name: string }[];
    nextPageToken: string | null;
  }> {
    const params = new URLSearchParams({
      page_size: "100",
      sort_type: "ByActiveTimeDesc",
    });
    if (pageToken) params.set("page_token", pageToken);
    const result = await this.request<{
      items?: { chat_id: string; name: string }[];
      has_more?: boolean;
      page_token?: string;
    }>(`im/v1/chats?${params}`);
    return {
      chats: (result.items ?? []).map((chat) => ({
        id: chat.chat_id,
        name: chat.name || "未命名群聊",
      })),
      nextPageToken: result.has_more ? result.page_token || null : null,
    };
  }
  async reply(messageId: string, text: string, uuid: string, replyInThread = false): Promise<string> {
    const result = await this.request<{ message_id: string }>(
      `im/v1/messages/${encodeURIComponent(messageId)}/reply`,
      { msg_type: "text", content: JSON.stringify({ text }), uuid, ...(replyInThread ? {reply_in_thread:true} : {}) },
    );
    return result.message_id;
  }
  async replyCard(
    messageId: string,
    card: unknown,
    uuid: string,
    replyInThread = false,
  ): Promise<string> {
    const result = await this.request<{ message_id: string }>(
      `im/v1/messages/${encodeURIComponent(messageId)}/reply`,
      { msg_type: "interactive", content: JSON.stringify(card), uuid, ...(replyInThread ? {reply_in_thread:true} : {}) },
    );
    return result.message_id;
  }
  async sendText(chatId: string, text: string, uuid: string): Promise<string> {
    const result = await this.request<{ message_id: string }>(
      "im/v1/messages?receive_id_type=chat_id",
      {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
        uuid,
      },
    );
    return result.message_id;
  }
  async sendCard(chatId: string, card: unknown, uuid: string): Promise<string> {
    const result = await this.request<{ message_id: string }>(
      "im/v1/messages?receive_id_type=chat_id",
      {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
        uuid,
      },
    );
    return result.message_id;
  }
  async resolveWiki(token: string): Promise<WikiNode> {
    return (
      await this.request<{ node: WikiNode }>(
        `wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`,
      )
    ).node;
  }
  async listWiki(spaceId: string, parent: string): Promise<WikiNode[]> {
    let page = "";
    const nodes: WikiNode[] = [];
    do {
      const result = await this.request<{
        items?: WikiNode[];
        has_more: boolean;
        page_token?: string;
      }>(
        `wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?parent_node_token=${encodeURIComponent(parent)}&page_size=50${page ? `&page_token=${encodeURIComponent(page)}` : ""}`,
      );
      // 目录为空时飞书只返回 has_more/page_token，不带 items 字段。
      nodes.push(...(result.items ?? []));
      page = result.has_more ? (result.page_token ?? "") : "";
      if (nodes.length > 2500)
        throw new Error("目录内容过多，请分年度整理后重试");
    } while (page);
    return nodes;
  }
  async createWikiDocument(
    spaceId: string,
    parent: string,
    title: string,
  ): Promise<WikiNode> {
    return (
      await this.request<{ node: WikiNode }>(
        `wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
        {
          obj_type: "docx",
          parent_node_token: parent,
          node_type: "origin",
          title,
        },
      )
    ).node;
  }
  async appendMarkdown(
    documentId: string,
    markdown: string,
    operationId: string,
    beforeChunk?: () => Promise<void>,
  ): Promise<string[]> {
    const children = markdownBlocks(markdown);
    // 远端分段标记支持幂等凭据过期后的恢复，也覆盖写入成功但响应丢失的情况。
    const markers = new Set<string>();
    let page = "";
    let count = 0;
    do {
      const existing = await this.request<{
        items: {
          text?: { elements?: { text_run?: { content?: string } }[] };
        }[];
        has_more?: boolean;
        page_token?: string;
      }>(
        `docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children?page_size=500${page ? `&page_token=${encodeURIComponent(page)}` : ""}`,
      );
      for (const block of existing.items ?? []) {
        const content = block.text?.elements
          ?.map((e) => e.text_run?.content ?? "")
          .join("");
        if (content) markers.add(content);
      }
      count += (existing.items ?? []).length;
      if (count > 10000) throw new Error("文档内容过多，请联系管理员整理");
      page = existing.has_more ? (existing.page_token ?? "") : "";
    } while (page);
    const ids: string[] = [];
    for (let i = 0; i < children.length; i += 40) {
      const marker = `Loop 同步记录 ${operationId} · ${i / 40 + 1}`;
      if (markers.has(marker)) continue;
      if (beforeChunk) await beforeChunk();
      const result = await this.request<{ children: { block_id: string }[] }>(
        `docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children?document_revision_id=-1&client_token=${await documentClientToken(operationId, i / 40)}`,
        {
          children: [
            ...children.slice(i, i + 40),
            {
              block_type: 2,
              text: { elements: [{ text_run: { content: marker } }] },
            },
          ],
          index: -1,
        },
      );
      ids.push(...result.children.map((c) => c.block_id));
    }
    return ids;
  }
  async image(
    messageId: string,
    key: string,
  ): Promise<{ bytes: Uint8Array; type: string }> {
    const response = await this.fetchImpl(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(key)}?type=image`,
      {
        headers: { authorization: `Bearer ${await this.accessToken()}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new FeishuApiError(response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("图片内容为空");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 5 * 1024 * 1024) throw new Error("图片不能超过 5MB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      bytes,
      type: (response.headers.get("content-type") ?? "").split(";")[0],
    };
  }
  async checkConnection(
    parent: string,
  ): Promise<WikiNode & { children: number }> {
    const node = await this.resolveWiki(parent);
    // 顺带读一次子节点：技术方案要写入这个目录，读取权限不足时这里就能发现。
    const children = await this.listWiki(node.space_id, node.node_token);
    return { ...node, children: children.length };
  }
}
