import test from "node:test";
import assert from "node:assert/strict";
import { decodeEvent, digest, seal, unseal } from "../crypto.ts";
import { bindingView, wikiToken } from "../bindings.ts";
import {
  documentClientToken,
  markdownBlocks,
  FeishuApiError,
  FeishuClient,
} from "../client.ts";
const master = Buffer.alloc(32, 7).toString("base64");
test("凭证加密绑定空间上下文，密文篡改不能解密", async () => {
  const encrypted = await seal(
    { appSecret: "test-secret" },
    master,
    "binding-a",
  );
  assert.ok(!encrypted.includes("test-secret"));
  assert.deepEqual(await unseal(encrypted, master, "binding-a"), {
    appSecret: "test-secret",
  });
  await assert.rejects(unseal(encrypted, master, "binding-b"));
  await assert.rejects(seal({}, "invalid", "binding-a"));
});
test("签名使用原始消息，拒绝过期、篡改和错误token", async () => {
  const raw = JSON.stringify({
      type: "url_verification",
      token: "token",
      challenge: "challenge",
    }),
    timestamp = String(Math.floor(Date.now() / 1000));
  const headers = new Headers({
    "x-lark-request-timestamp": timestamp,
    "x-lark-request-nonce": "nonce",
    "x-lark-signature": await digest(timestamp + "nonce" + "encrypt" + raw),
  });
  assert.equal(
    (await decodeEvent(raw, headers, "encrypt", "token")).challenge,
    "challenge",
  );
  await assert.rejects(decodeEvent(raw + " ", headers, "encrypt", "token"));
  await assert.rejects(decodeEvent(raw, headers, "encrypt", "wrong"));
  await assert.rejects(
    decodeEvent(raw, headers, "encrypt", "token", Date.now() + 600000),
  );
});
test("按飞书AES-CBC规范解密加密事件", async () => {
  const raw = JSON.stringify({
      header: { token: "token", app_id: "cli_test" },
      event: {},
    }),
    iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("encrypt")),
    "AES-CBC",
    false,
    ["encrypt"],
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      key,
      new TextEncoder().encode(raw),
    ),
  );
  const request = JSON.stringify({
      encrypt: Buffer.concat([iv, cipher]).toString("base64"),
    }),
    timestamp = String(Math.floor(Date.now() / 1000));
  const headers = new Headers({
    "x-lark-request-timestamp": timestamp,
    "x-lark-request-nonce": "nonce",
    "x-lark-signature": await digest(timestamp + "nonce" + "encrypt" + request),
  });
  assert.equal(
    (await decodeEvent(request, headers, "encrypt", "token")).header?.app_id,
    "cli_test",
  );
});
test("目录只接受飞书Wiki链接，禁止普通docx和外部主机", () => {
  assert.equal(
    wikiToken("https://example.feishu.cn/wiki/Abc123?from=from_copylink"),
    "Abc123",
  );
  for (const url of [
    "https://example.feishu.cn/docx/Abc",
    "https://feishu.cn.evil.com/wiki/Abc",
    "http://example.feishu.cn/wiki/Abc",
    "broken",
  ])
    assert.throws(() => wikiToken(url));
});
test("飞书客户端token按实例复用，回复包含幂等ID，正文分块写入携带固定token", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url, init) => {
    const uri = String(url),
      body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ url: uri, body });
    if (uri.includes("/auth/"))
      return Response.json({ code: 0, tenant_access_token: "token" });
    if (uri.includes("/reply"))
      return Response.json({ code: 0, data: { message_id: "om_reply" } });
    return Response.json({
      code: 0,
      data: { children: [{ block_id: "block" }] },
    });
  }) as typeof fetch;
  const client = new FeishuClient(
    {
      appId: "cli_test",
      appSecret: "secret",
      verificationToken: "token",
      encryptKey: "encrypt",
    },
    fetchImpl,
  );
  assert.equal(
    await client.reply("om_message", "hello", "unique-id"),
    "om_reply",
  );
  await client.appendMarkdown("doc", "a\n".repeat(50), "fixed-operation");
  assert.equal(requests.filter((r) => r.url.includes("/auth/")).length, 1);
  assert.equal(requests[1].body.uuid, "unique-id");
  assert.equal(requests[1].body.reply_in_thread, undefined);
  await client.reply("om_thread","thread reply","thread-id",true);
  assert.equal(requests.at(-1)!.body.reply_in_thread,true);
  const tokens = await Promise.all([
    documentClientToken("fixed-operation", 0),
    documentClientToken("fixed-operation", 1),
  ]);
  for (const token of tokens) {
    assert.match(
      token,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    assert.ok(requests.some((r) => r.url.includes(`client_token=${token}`)));
  }
});
test("状态通知以交互卡片发送，回复和主动发送都带幂等ID", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url, init) => {
    const uri = String(url),
      body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ url: uri, body });
    if (uri.includes("/auth/"))
      return Response.json({ code: 0, tenant_access_token: "token" });
    return Response.json({ code: 0, data: { message_id: "om_card" } });
  }) as typeof fetch;
  const client = new FeishuClient(
    {
      appId: "cli_test",
      appSecret: "secret",
      verificationToken: "token",
      encryptKey: "encrypt",
    },
    fetchImpl,
  );
  const card = {
    header: { title: { tag: "plain_text", content: "【待人工处理】改动待审核" } },
    elements: [],
  };
  await client.replyCard("om_message", card, "reply-card-id", true);
  await client.sendCard("oc_chat", card, "send-card-id");
  assert.equal(requests[1].body.msg_type, "interactive");
  assert.equal(requests[1].body.uuid, "reply-card-id");
  assert.equal(requests[1].body.reply_in_thread,true);
  assert.deepEqual(JSON.parse(String(requests[1].body.content)), card);
  assert.equal(requests[2].body.msg_type, "interactive");
  assert.equal(requests[2].body.uuid, "send-card-id");
});

test("目录为空时飞书不返回 items，按空目录处理", async () => {
  const fetchImpl = (async (url) => {
    if (String(url).includes("/auth/"))
      return Response.json({ code: 0, tenant_access_token: "token" });
    return Response.json({
      code: 0,
      data: { has_more: false, page_token: "" },
    });
  }) as typeof fetch;
  const client = new FeishuClient(
    {
      appId: "cli_test",
      appSecret: "secret",
      verificationToken: "token",
      encryptKey: "encrypt",
    },
    fetchImpl,
  );
  assert.deepEqual(await client.listWiki("space", "parent"), []);
  assert.deepEqual(await client.listChats(), { chats: [], nextPageToken: null });
});

import type { Db } from "../../pg.ts";
import type { Binding } from "../bindings.ts";
import { processMessage, type MessageEvent } from "../jobs/messages.ts";
import type { Job } from "../jobs/store.ts";
function messageDb(
  options: {
    member?: boolean;
    route?: boolean;
    projects?: { id: string; name: string }[];
  } = {},
) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first() {
          calls.push({ sql, values: statement.values });
          if (sql.includes("SELECT i.user_id"))
            return options.member ? { user_id: "user" } : null;
          if (sql.includes("SELECT project_id FROM feishu_chat_routes"))
            return options.route ? { project_id: "project" } : null;
          return null;
        },
        async all() {
          calls.push({ sql, values: statement.values });
          return {
            results: options.projects ?? [{ id: "project", name: "网站" }],
          };
        },
        async run() {
          calls.push({ sql, values: statement.values });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as Db;
  return { db, calls };
}
const binding = {
  id: "binding",
  space_id: "space",
  default_project_id: null,
} as Binding;
const job = { id: "job" } as Job;
const unusedClient = new FeishuClient({
  appId: "cli_test",
  appSecret: "secret",
  verificationToken: "token",
  encryptKey: "encrypt",
});
const event = (text: string, group = false): MessageEvent => ({
  sender: { sender_id: { open_id: "open" }, sender_type: "user" },
  message: {
    message_id: "om_msg",
    chat_id: "oc_chat",
    chat_type: group ? "group" : "p2p",
    message_type: "text",
    content: JSON.stringify({ text }),
    ...(group
      ? { mentions: [{ key: "@_user_1", id: { open_id: "bot" } }] }
      : {}),
  },
});
test("未关联账号只能收到关联提示，不能查询项目或创建任务", async () => {
  const { db, calls } = messageDb();
  await processMessage(
    db,
    binding,
    event("创建任务：修改标题"),
    job,
    unusedClient,
    "https://loop.test",
  );
  assert.equal(calls.filter((c) => c.sql.includes("FROM projects")).length, 0);
  const queued = calls.find((c) => c.sql.startsWith("INSERT INTO feishu_jobs"));
  assert.ok(queued);
  assert.match(String(queued.values[4]), /关联账号/);
});
test("群消息必须显式接入项目，没有@时忽略", async () => {
  const first = messageDb({ member: true });
  await processMessage(
    first.db,
    binding,
    event("创建任务：修改标题", true),
    job,
    unusedClient,
    "https://loop.test",
  );
  assert.ok(
    first.calls.some((c) => String(c.values[4]).includes("这个群尚未接入项目")),
  );
  const second = messageDb({ member: true, route: true });
  const data = event("创建任务：修改标题", true);
  data.message.mentions = [];
  await processMessage(
    second.db,
    binding,
    data,
    job,
    unusedClient,
    "https://loop.test",
  );
  assert.equal(second.calls.length, 0);
});
test("多项目单聊先持久保存需求并提供项目选择，普通咨询不会创建草稿", async () => {
  const { db, calls } = messageDb({
    member: true,
    projects: [
      { id: "a", name: "网站" },
      { id: "b", name: "后台" },
    ],
  });
  await processMessage(
    db,
    binding,
    event("请帮我创建一个任务：修改标题"),
    job,
    unusedClient,
    "https://loop.test",
  );
  const draft = calls.find((c) =>
    c.sql.startsWith("INSERT INTO feishu_drafts"),
  );
  assert.ok(draft);
  assert.equal(draft.values[3], "请帮我创建一个任务：修改标题");
  const consult = messageDb({ member: true });
  await processMessage(
    consult.db,
    binding,
    event("你能做什么"),
    job,
    unusedClient,
    "https://loop.test",
  );
  assert.equal(
    consult.calls.filter((c) => c.sql.startsWith("INSERT INTO feishu_drafts"))
      .length,
    0,
  );
});

test("Markdown 转换使用真实标题、列表与代码块", () => {
  const blocks = markdownBlocks(
    "# 标题\n- 项目\n1. 步骤\n```ts\nconst value=1;\n```",
  );
  assert.deepEqual(
    blocks.map((b) => b.block_type),
    [3, 12, 13, 14],
  );
});

import { attachmentName } from "../jobs/messages.ts";
test("图片文件名兼容现有读取接口且重试复用同一对象", async () => {
  const first = await attachmentName("binding", "message", "png");
  assert.match(first, /^img_[0-9a-f]{16}\.(png|jpg|gif|webp)$/);
  assert.equal(await attachmentName("binding", "message", "png"), first);
  assert.notEqual(
    await attachmentName("other-binding", "message", "png"),
    first,
  );
});

test("地址验证允许无签名头，仍校验 token，普通事件和错误签名不能绕过", async () => {
  const raw = JSON.stringify({
    type: "url_verification",
    token: "token",
    challenge: "challenge",
  });
  assert.equal(
    (await decodeEvent(raw, new Headers(), "encrypt", "token")).challenge,
    "challenge",
  );
  await assert.rejects(decodeEvent(raw, new Headers(), "encrypt", "wrong"));
  await assert.rejects(decodeEvent(raw, new Headers(), "encrypt", ""));
  await assert.rejects(
    decodeEvent(
      JSON.stringify({
        header: { token: "token", event_type: "im.message.receive_v1" },
      }),
      new Headers(),
      "encrypt",
      "token",
    ),
  );
  await assert.rejects(
    decodeEvent(
      raw,
      new Headers({ "x-lark-signature": "bad" }),
      "encrypt",
      "token",
    ),
  );
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("encrypt")),
    "AES-CBC",
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    new TextEncoder().encode(raw),
  );
  const encrypted = JSON.stringify({
    encrypt: Buffer.concat([iv, new Uint8Array(cipher)]).toString("base64"),
  });
  assert.equal(
    (await decodeEvent(encrypted, new Headers(), "encrypt", "token")).challenge,
    "challenge",
  );
  await assert.rejects(
    decodeEvent(encrypted, new Headers(), "wrong-key", "token"),
  );
});
test("设置视图暴露最近消息与企业不匹配状态", () => {
  const binding = {
    id: "binding-a",
    space_id: "space-a",
    app_id: "cli_test",
    tenant_key: "tenant_a",
    secrets: "v1.x.y",
    wiki_url: "https://demo.feishu.cn/wiki/abc",
    default_project_id: null,
    notification_chat_id: null,
    enabled: 1,
    created_at: 0,
    updated_at: 0,
    tenant_verified_at: 1,
    last_event_at: 10,
    tenant_mismatch_at: 20,
    tenant_mismatch_key: "tenant_b",
  } satisfies Binding;
  const view = bindingView(binding, "https://loop.example");
  assert.equal(view.lastEventAt, 10);
  assert.equal(view.tenantMismatchAt, 20);
  assert.equal(view.tenantMismatchKey, "tenant_b");
  assert.equal(view.callbackUrl, "https://loop.example/api/feishu/webhook/binding-a");
  assert.equal(bindingView({ ...binding, tenant_mismatch_at: null }, "https://loop.example").tenantMismatchAt, null);
});

test("飞书权限错误指出缺失的 scope，便于用户申请", () => {
  const error = new FeishuApiError(
    99991672,
    "Access denied. One of the following scopes is required: [wiki:wiki, wiki:node:create].应用尚未开通所需的应用身份权限：[wiki:wiki, wiki:node:create]",
  );
  assert.match(error.message, /99991672/);
  assert.match(error.message, /wiki:wiki、wiki:node:create/);
  assert.match(
    new FeishuApiError(
      131006,
      "permission denied: node permission denied, tenant needs edit permission.",
    ).message,
    /知识库成员/,
  );
  assert.equal(
    new FeishuApiError(230002).message,
    "飞书操作失败（错误码 230002），请检查应用权限和目录授权",
  );
});
