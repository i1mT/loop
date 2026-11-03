import { test } from "node:test";
import assert from "node:assert/strict";
import { timeAgo, shortSha } from "./format.ts";

test("相对时间", () => {
  const now = 1_000_000_000_000;
  assert.equal(timeAgo(now - 3000, now), "刚刚");
  assert.equal(timeAgo(now - 45_000, now), "45 秒前");
  assert.equal(timeAgo(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(timeAgo(now - 3 * 3600_000, now), "3 小时前");
  assert.equal(timeAgo(now - 2 * 86400_000, now), "2 天前");
});

test("短提交哈希", () => {
  assert.equal(shortSha("abcdef1234567890"), "abcdef12");
  assert.equal(shortSha(null), "无");
});
