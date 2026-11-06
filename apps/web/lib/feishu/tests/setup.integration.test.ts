import test from "node:test";
import assert from "node:assert/strict";
import { Db } from "../../pg.ts";
import { migrate } from "../../migrations.ts";
import { saveBinding, getBinding, getBindingSecrets } from "../bindings.ts";
import { pinEventTenant } from "../events.ts";
const key = Buffer.alloc(32, 9).toString("base64");
test(
  "自建应用配置无需企业标识，首次事件并发绑定和修改凭证保持安全边界",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = new Db(process.env.DATABASE_URL!);
    await migrate(db);
    const id = `setup-${crypto.randomUUID()}`;
    try {
      await db
        .prepare(`INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)`)
        .bind(id, "配置测试", Date.now())
        .run();
      const input = {
        appId: `cli_${crypto.randomUUID().replaceAll("-", "")}`,
        appSecret: "app-secret",
        verificationToken: "event-token",
        encryptKey: "encryption",
        wikiUrl: "https://example.feishu.cn/wiki/parent",
        notificationChatId: "oc_group",
        notificationChatName: "研发讨论",
        enabled: true,
      };
      const binding = await saveBinding(db, id, input, key);
      assert.equal(binding.tenant_key, "");
  assert.equal(binding.tenant_verified_at, null);
      assert.equal(binding.notification_chat_name, "研发讨论");
      const values = await Promise.all(
        ["companyA", "companyB"].map((tenant) =>
          pinEventTenant(db, binding, {
            header: { app_id: input.appId, tenant_key: tenant },
            event: { sender: { tenant_key: tenant } },
          }),
        ),
      );
      assert.deepEqual([...values].sort(), [false, true]);
      const pinned = (await getBinding(db, id))!.tenant_key;
      await db
        .prepare(
          `UPDATE space_feishu_bindings SET callback_verified_at=123 WHERE id=?`,
        )
        .bind(binding.id)
        .run();
      const saved = await saveBinding(
        db,
        id,
        {
          ...input,
          tenantKey: "overwrite",
          appSecret: undefined,
          verificationToken: undefined,
          encryptKey: undefined,
        },
        key,
      );
      assert.equal(saved.tenant_key, pinned);
      assert.equal(saved.callback_verified_at, 123);
      assert.equal(
        (await getBindingSecrets(db, binding.id, key)).appSecret,
        "app-secret",
      );
      const rotated = await saveBinding(
        db,
        id,
        { ...input, encryptKey: "new-encryption" },
        key,
      );
      assert.equal(rotated.callback_verified_at, null);
      assert.equal(rotated.tenant_key, pinned);
    } finally {
      await db
        .prepare(`DELETE FROM space_feishu_bindings WHERE space_id=?`)
        .bind(id)
        .run();
      await db.prepare(`DELETE FROM spaces WHERE id=?`).bind(id).run();
    }
  },
);
