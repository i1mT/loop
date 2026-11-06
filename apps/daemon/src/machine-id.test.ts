import { test } from "node:test";
import assert from "node:assert/strict";
import { machineIdFrom } from "./serve.ts";

test("主机名规整为合法机器 ID", () => {
  assert.equal(machineIdFrom("Example-MacBook-Pro.local"), "example-macbook-pro.local");
  assert.equal(machineIdFrom("My Home PC"), "my-home-pc");
  assert.equal(machineIdFrom("--x"), "x");
  assert.equal(machineIdFrom("!!!"), "machine");
  assert.equal(machineIdFrom("a".repeat(100)).length, 64);
});
