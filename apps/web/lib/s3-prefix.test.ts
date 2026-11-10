import { test } from "node:test";
import assert from "node:assert/strict";
import { prefix } from "./storage/index.node.ts";
import { s3ObjectStore } from "./storage/s3.node.ts";

// S3_PREFIX 让多个部署共用一个桶。前缀必须对所有读、写、分片操作一致生效，
// 否则会出现“上传到 a/ 但读取去 b/”这种只有部分功能坏掉的问题。

test("前缀规范化：缺省、多余斜杠都收敛成单层结尾斜杠", () => {
  assert.equal(prefix(""), "", "留空表示桶根");
  assert.equal(prefix("loop"), "loop/");
  assert.equal(prefix("loop/"), "loop/");
  assert.equal(prefix("/loop/"), "loop/");
  assert.equal(prefix("  loop  "), "loop/", "允许两端空白");
  assert.equal(prefix("a/b"), "a/b/", "保留多级目录");
  assert.equal(prefix("/"), "", "只有斜杠视为留空");
});

test("前缀对写入、读取、HEAD 与分片上传一致生效", async () => {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  // 用记录型客户端替身，只关心发出去的 Key；不需要真实网络。
  const client = {
    async send(command: { input: Record<string, unknown>; constructor: { name: string } }) {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "GetObjectCommand" || command.constructor.name === "HeadObjectCommand") {
        return { Body: null, ContentLength: 3, ETag: '"abc"' };
      }
      if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "upload-1" };
      if (command.constructor.name === "UploadPartCommand") return { ETag: '"part-1"' };
      return {};
    },
  };
  const store = s3ObjectStore(client as never, "bucket", "loop/");
  const bytes = new Uint8Array([1]);

  await store.put("img_a.png", bytes, { httpMetadata: { contentType: "image/png" } });
  await store.get("img_a.png");
  await store.head("img_a.png");
  await store.createMultipartUpload("daemon-releases/manifest.json", {});
  const upload = await store.resumeMultipartUpload("daemon-releases/manifest.json", "upload-2");
  await upload.uploadPart(1, bytes);
  await upload.abort();
  await upload.complete([{ partNumber: 1, etag: "e" }]);

  assert.deepEqual(
    sent.map((entry) => [entry.name, entry.input.Key]),
    [
      ["PutObjectCommand", "loop/img_a.png"],
      ["GetObjectCommand", "loop/img_a.png"],
      ["HeadObjectCommand", "loop/img_a.png"],
      ["CreateMultipartUploadCommand", "loop/daemon-releases/manifest.json"],
      ["UploadPartCommand", "loop/daemon-releases/manifest.json"],
      ["AbortMultipartUploadCommand", "loop/daemon-releases/manifest.json"],
      ["CompleteMultipartUploadCommand", "loop/daemon-releases/manifest.json"],
    ],
    "每个操作都加上同一前缀",
  );
});

test("前缀留空时键与桶根一致，不额外加斜杠", async () => {
  const sent: string[] = [];
  const client = {
    async send(command: { input: Record<string, unknown>; constructor: { name: string } }) {
      sent.push(String(command.input.Key));
      return { ContentLength: 1, ETag: '"x"' };
    },
  };
  const store = s3ObjectStore(client as never, "bucket");
  const bytes = new Uint8Array([1]);
  await store.put("img_a.png", bytes);
  await store.get("img_a.png");
  assert.deepEqual(sent, ["img_a.png", "img_a.png"]);
});
