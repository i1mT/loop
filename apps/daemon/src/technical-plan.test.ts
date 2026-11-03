import {test} from "node:test";
import assert from "node:assert/strict";
import {extractTechnicalPlan,continuationPrompt} from "./technical-plan/contract.ts";
const valid=["背景","目标","技术实现","改动点","验证方式","风险与回滚"].map(x=>`## ${x}\n这是用于验证完整方案的具体内容。`).join("\n");
test("技术方案只接受完整标记和全部章节",()=>{
  assert.equal(extractTechnicalPlan(`<loop-technical-plan>\n${valid}\n</loop-technical-plan>`),valid);
  assert.throws(()=>extractTechnicalPlan(valid));
  assert.throws(()=>extractTechnicalPlan(`<loop-technical-plan>${valid.replace("## 改动点","改动点")}</loop-technical-plan>`));
});
test("实现消息绑定明确轮次与方案版本",()=>{
  const prompt=continuationPrompt({phase:"implementing",round:2,revision:3,markdown:valid,documentUrl:"https://example.com/wiki/x",syncError:null,continuationId:"task:2:3"});
  assert.ok(prompt.startsWith("【Loop 方案执行 task:2:3】"));
  assert.ok(prompt.includes(valid));
});
