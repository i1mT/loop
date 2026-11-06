import test from "node:test";
import assert from "node:assert/strict";
import { FeishuClient } from "../client.ts";
import { pinEventTenant } from "../events.ts";
import type { Binding } from "../bindings.ts";
import type { Db } from "../../pg.ts";

const binding = {
  id: "binding",
  app_id: "cli_example",
  tenant_key: "",
} as Binding;
function database() {
  let tenant = "";
  return {
    db: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => {
            if (sql.startsWith("UPDATE")) {
              if (tenant) return null;
              tenant = String(values[0]);
              return { tenant_key: tenant };
            }
            return { tenant_key: tenant };
          },
        }),
      }),
    } as unknown as Db,
    tenant: () => tenant,
  };
}
const event = (tenant: string, app = "cli_example") => ({
  header: { app_id: app, tenant_key: tenant },
  event: { sender: { tenant_key: tenant } },
});
test("企业自建应用只用 App ID 和 Secret 获取群列表，并按分页返回群名称", async () => {
  const calls: {
    url: string;
    body: Record<string, unknown>;
    authorization: string | null;
  }[] = [];
  const fetchImpl = (async (url, init) => {
    const uri = String(url);
    calls.push({
      url: uri,
      body: JSON.parse(String(init?.body ?? "{}")),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (uri.includes("/auth/"))
      return Response.json({ code: 0, tenant_access_token: "access" });
    return Response.json({
      code: 0,
      data: {
        items: [{ chat_id: "oc_group", name: "研发讨论" }],
        has_more: !uri.includes("page_token"),
        page_token: "next",
      },
    });
  }) as typeof fetch;
  const client = new FeishuClient(
    {
      appId: "cli_example",
      appSecret: "secret",
      verificationToken: "",
      encryptKey: "",
    },
    fetchImpl,
  );
  const first = await client.listChats();
  assert.deepEqual(first, {
    chats: [{ id: "oc_group", name: "研发讨论" }],
    nextPageToken: "next",
  });
  assert.equal(
    (await client.listChats(first.nextPageToken!)).nextPageToken,
    null,
  );
  assert.deepEqual(calls[0].body, {
    app_id: "cli_example",
    app_secret: "secret",
  });
  assert.equal(calls[1].authorization, "Bearer access");
  assert.match(calls[2].url, /page_token=next/);
});
test("企业归属仅由完整、匹配的已验证事件首次记录，不能跨企业覆盖", async () => {
  const state = database();
  assert.equal(
    await pinEventTenant(state.db, binding, {
      type: "url_verification",
      challenge: "challenge",
    }),
    false,
  );
  assert.equal(
    await pinEventTenant(state.db, binding, event("company", "cli_other")),
    false,
  );
  assert.equal(state.tenant(), "");
  assert.equal(
    await pinEventTenant(state.db, binding, {
      ...event("company"),
      event: { sender: { tenant_key: "other" } },
    }),
    false,
  );
  assert.equal(await pinEventTenant(state.db, binding, event("company")), true);
  assert.equal(await pinEventTenant(state.db, binding, event("other")), false);
  assert.equal(state.tenant(), "company");
  assert.equal(
    await pinEventTenant(
      state.db,
      { ...binding, tenant_key: "company", tenant_verified_at: 123 },
      event("company"),
    ),
    true,
  );
});
