import {test} from "node:test";
import assert from "node:assert/strict";
import {extractTechnicalPlan,continuationPrompt} from "./technical-plan/contract.ts";
const valid=["背景","目标","技术实现","改动点","验证方式","风险与回滚"].map(x=>`## ${x}\n这是用于验证完整方案的具体内容。`).join("\n");
test("技术方案接受标记内的 AI 标题",()=>{
  assert.deepEqual(
    extractTechnicalPlan(`<loop-technical-plan>\n# 登录态自动续期方案\n${valid}\n</loop-technical-plan>`),
    {title:"登录态自动续期方案",markdown:valid},
  );
});
test("技术方案标题写在标记外也能保存（真实智能体的一种输出）",()=>{
  assert.deepEqual(
    extractTechnicalPlan(`# 全局反馈入口迁移至顶栏\n\n<loop-technical-plan>\n${valid}\n</loop-technical-plan>`),
    {title:"全局反馈入口迁移至顶栏",markdown:valid},
  );
  assert.deepEqual(
    extractTechnicalPlan(`<loop-technical-plan>\n## 顶栏反馈入口\n${valid}\n</loop-technical-plan>`),
    {title:"顶栏反馈入口",markdown:valid},
  );
});
test("完全没有标题时用通用标题，不再每 20 秒重试同一份方案",()=>{
  assert.deepEqual(
    extractTechnicalPlan(`<loop-technical-plan>\n${valid}\n</loop-technical-plan>`),
    {title:"技术方案",markdown:valid},
  );
  assert.throws(()=>extractTechnicalPlan(valid));
});
test("章节缺失仍然拒绝",()=>{
  assert.throws(()=>extractTechnicalPlan(`<loop-technical-plan>\n# 标题\n${valid.replace("## 改动点","改动点")}\n</loop-technical-plan>`));
});
test("实现消息绑定明确轮次与方案版本",()=>{
  const prompt=continuationPrompt({title:"标题",phase:"implementing",round:2,revision:3,markdown:valid,documentUrl:"https://example.com/wiki/x",syncError:null,continuationId:"task:2:3"});
  assert.ok(prompt.startsWith("【Loop 方案执行 task:2:3】"));
  assert.ok(prompt.includes(valid));
});
