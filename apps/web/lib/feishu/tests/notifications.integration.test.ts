import { notificationContext } from "../jobs/context.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../../pg.ts";
import { migrate } from "../../migrations.ts";
import { useDb } from "../../db.ts";
import { hello } from "../../machines.ts";
import { createProject, createTask, setStage } from "../../tasks.ts";
import { approveTask,rejectTask,cancelTask,decidePlan,confirmPublish,iterateTask,enqueueForTask } from "../../daemon-api.ts";
import { saveBinding } from "../bindings.ts";
import { enqueueTaskNotification,enqueuePlanNotification } from "../jobs/notifications.ts";
import { processFeishuJobs } from "../jobs/runner.ts";
const skip=!process.env.DATABASE_URL,key=Buffer.alloc(32,7).toString("base64"),origin="https://loop.test";
async function setup(){
 const db=new Db(process.env.DATABASE_URL!);await migrate(db);useDb(db);
 const id=crypto.randomUUID().replaceAll("-",""),space=`notify-${id}`,machine=`notify-machine-${id}`;
 await db.prepare(`INSERT INTO spaces(id,name,created_at) VALUES(?,?,0)`).bind(space,space).run();
 await hello(db,{machineId:machine,agents:[{kind:"grok",installed:true,acp:true,version:"test",note:null}]});
 const project=await createProject({name:"通知测试",spaceId:space,githubRepo:"fixture/notifications",machineId:machine,agent:"grok"});
 const binding=await saveBinding(db,space,{appId:`cli_${id}`,appSecret:"secret",verificationToken:"verify",encryptKey:"encrypt",wikiUrl:"https://test.feishu.cn/wiki/parent",notificationChatId:`oc_${id}`,enabled:true},key);
 const task=await createTask({projectId:project.id,title:"消息测试"});
 await db.prepare(`UPDATE feishu_stage_events SET queued=1 WHERE task_id=?`).bind(task.id).run();
 const calls:{url:string;body:Record<string,any>}[]=[],remote=new Map<string,string>();
 let hook:((url:string,body:Record<string,any>)=>Promise<void>)|null=null;
 const fetchImpl=(async(url,init)=>{
  if(String(url).includes("/auth/"))return Response.json({code:0,tenant_access_token:"test-token"});
  const body=JSON.parse(String(init?.body)),uri=String(url);calls.push({url:uri,body});
  if(!remote.has(body.uuid))remote.set(body.uuid,`om_${remote.size+1}`);
  if(hook)await hook(uri,body);
  return Response.json({code:0,data:{message_id:remote.get(body.uuid)}});
 }) as typeof fetch;
 const drain=()=>processFeishuJobs(db,key,origin,30,fetchImpl);
 const ready=()=>db.prepare(`UPDATE feishu_jobs SET next_at=0 WHERE binding_id=? AND state='pending'`).bind(binding.id).run();
 return {db,space,machine,project,binding,task,calls,remote,fetchImpl,drain,ready,setHook:(value:typeof hook)=>{hook=value;}};
}
type Fixture=Awaited<ReturnType<typeof setup>>;
async function fixture(run:(f:Fixture)=>Promise<void>){
 const f=await setup();try{await run(f);}finally{
  await f.db.batch([
   f.db.prepare(`DELETE FROM feedbacks WHERE project_id=?`).bind(f.project.id),
   f.db.prepare(`DELETE FROM inbox WHERE session_id IN (SELECT id FROM sessions WHERE task_id=?)`).bind(f.task.id),
   f.db.prepare(`DELETE FROM sessions WHERE task_id=?`).bind(f.task.id),
   f.db.prepare(`DELETE FROM leases WHERE task_id=?`).bind(f.task.id),
   f.db.prepare(`DELETE FROM tasks WHERE project_id=?`).bind(f.project.id),
   f.db.prepare(`DELETE FROM space_feishu_bindings WHERE space_id=?`).bind(f.space),
   f.db.prepare(`DELETE FROM projects WHERE id=?`).bind(f.project.id),
   f.db.prepare(`DELETE FROM space_machines WHERE machine_id=?`).bind(f.machine),
   f.db.prepare(`DELETE FROM spaces WHERE id=?`).bind(f.space),
   f.db.prepare(`DELETE FROM machine_agents WHERE machine_id=?`).bind(f.machine),
   f.db.prepare(`DELETE FROM machines WHERE id=?`).bind(f.machine),
  ]);
 }
}
test("来源消息分别使用话题回复，私聊正常回复；方案只有链接，通知没有轮次",{skip},()=>fixture(async f=>{
 for(let i=0;i<3;i++){
  await f.db.prepare(`INSERT INTO feedbacks(id,project_id,source,title,body,state,task_id,created_at,updated_at) VALUES(?,?,'feishu','反馈','','linked',?,0,0)`)
   .bind(`feedback-${f.task.id}-${i}`,f.project.id,f.task.id).run();
 }
 assert.equal(await enqueueTaskNotification(f.db,f.task.id,"pending-source","running",origin),false);
 for(let i=0;i<3;i++){await f.db.prepare(`INSERT INTO feedback_subscriptions(feedback_id,binding_id,chat_id,message_id,chat_type) VALUES(?,?,?,?,?)`)
  .bind(`feedback-${f.task.id}-${i}`,f.binding.id,i<2?"oc_source":"oc_private",`om_original${i}`,i<2?"group":"p2p").run();
  if(i===0)assert.equal(await enqueueTaskNotification(f.db,f.task.id,"partial-source","running",origin),false);
 }
 await enqueueTaskNotification(f.db,f.task.id,"running","running",origin);
 const fullText="不应出现在通知中的长方案".repeat(1000);
 await enqueuePlanNotification(f.db,{taskId:f.task.id,round:1,revision:1,title:"改造方案",documentUrl:"https://test.feishu.cn/wiki/plan",reviewRequired:true,...{markdown:fullText}},origin);
 await f.drain();assert.equal(f.calls.length,6);
 for(const call of f.calls){
  assert.match(call.url,/om_original[012]\/reply$/);
  assert.equal(call.body.reply_in_thread,call.url.includes("om_original2")?undefined:true);
  assert.doesNotMatch(call.body.content,/第\s*\d+\s*轮/);
  assert.ok(!call.body.content.includes("不应出现在通知中的长方案"));
 }
 assert.ok(f.calls.some(call=>call.body.content.includes("https://test.feishu.cn/wiki/plan")));
}));
test("非飞书来源：并发通知只创建一个话题，后续通知和迭代持续回复首条消息",{skip},()=>fixture(async f=>{
 await enqueueTaskNotification(f.db,f.task.id,"one","running",origin);
 await enqueueTaskNotification(f.db,f.task.id,"two","reviewing",origin);
 let entered!:()=>void,release!:()=>void;
 const entering=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 f.setHook(async()=>{entered();await gate;});
 const first=processFeishuJobs(f.db,key,origin,1,f.fetchImpl);await entering;
 try {const concurrent=await processFeishuJobs(f.db,key,origin,1,f.fetchImpl);assert.equal(concurrent.failed,0);assert.equal(f.calls.length,1);}finally{release();}
 await first;f.setHook(null);await f.ready();await f.drain();
 assert.equal(f.calls.filter(call=>!call.url.endsWith("/reply")).length,1);
 const thread=(await f.db.prepare(`SELECT root_message_id FROM feishu_task_threads WHERE task_id=?`).bind(f.task.id).first<{root_message_id:string}>())!;
 assert.ok(f.calls.some(call=>call.url.endsWith(thread.root_message_id+"/reply")&&call.body.reply_in_thread===true));
 await f.db.prepare(`UPDATE tasks SET round=2 WHERE id=?`).bind(f.task.id).run();
 await f.drain();assert.equal(f.calls.filter(call=>!call.url.endsWith("/reply")).length,1);
}));
test("首条发送响应丢失后沿用幂等标识；回执已经保存时恢复不重复发送",{skip},()=>fixture(async f=>{
 await enqueueTaskNotification(f.db,f.task.id,"recover","running",origin);
 let lost=true;f.setHook(async()=>{if(lost){lost=false;throw new Error("response lost");}});
 assert.equal((await f.drain()).failed,1);assert.equal(f.remote.size,1);
 await enqueueTaskNotification(f.db,f.task.id,"newer","reviewing",origin);
 await f.drain();assert.equal(f.remote.size,2);assert.equal(f.calls[0].body.uuid,f.calls[1].body.uuid);
 assert.equal(f.calls[0].body.content,f.calls[1].body.content,"恢复首条通知必须使用原始内容");
 assert.ok(f.calls[2].url.endsWith("/om_1/reply"));
 assert.ok(f.calls[2].body.content.includes("改动待审核"),"后续通知不能被首条通知的回执吞掉");
 await f.ready();await f.drain();
 const sent=f.calls.length;
 await f.db.prepare(`UPDATE feishu_jobs SET state='pending',next_at=0 WHERE binding_id=?`).bind(f.binding.id).run();
 await f.drain();assert.equal(f.calls.length,sent);
}));
test("审批、驳回、取消、方案审批与发布确认保存独立备注；迭代和恢复执行带上用户反馈",{skip},()=>fixture(async f=>{
 const stage=async(value:string)=>f.db.prepare(`UPDATE tasks SET stage=?,head_sha='abcdef',updated_at=? WHERE id=?`).bind(value,Date.now(),f.task.id).run();
 await stage("reviewing");assert.equal((await approveTask(f.task.id,"admin","可以发布，注意缓存")).ok,true);
 await stage("reviewing");assert.equal((await rejectTask(f.task.id,"请调整按钮颜色")).ok,true);
 await stage("running");assert.equal((await cancelTask(f.task.id,"需求暂缓")).ok,true);
 await stage("plan_reviewing");
 await f.db.prepare(`UPDATE task_plan_rounds SET phase='awaiting_review',document_url='https://test.feishu.cn/wiki/plan' WHERE task_id=?`).bind(f.task.id).run();
 assert.equal((await decidePlan(f.task.id,"approve","按照方案执行",1)).ok,true);
 await stage("publish_review");assert.equal((await confirmPublish(f.task.id,true,"线上已经验收")).ok,true);
 const rows=(await f.db.prepare(`SELECT stage,detail FROM feishu_stage_events WHERE task_id=? AND detail IS NOT NULL ORDER BY id`).bind(f.task.id).all<{stage:string;detail:string}>()).results;
 for(const detail of ["可以发布，注意缓存","请调整按钮颜色","需求暂缓","按照方案执行","线上已经验收"])assert.ok(rows.some(row=>row.detail===detail),detail);
 await f.drain();for(const row of rows)assert.ok(f.calls.some(call=>call.body.content.includes(row.detail)));
 await f.db.prepare(`INSERT INTO sessions(id,task_id,agent,state,created_at,updated_at) VALUES(?,?,'grok','idle',0,0)`).bind(`session-${f.task.id}`,f.task.id).run();
 assert.equal((await iterateTask(f.task.id,"请增加键盘操作")).ok,true);await f.drain();
 await stage("needs_you");await enqueueForTask(f.task.id,{kind:"message",body:"继续执行，保留旧数据"});await setStage(f.task.id,"running");await f.drain();
 for(const detail of ["请增加键盘操作","继续执行，保留旧数据"])assert.ok(f.calls.some(call=>call.body.content.includes(detail)),detail);
 assert.equal(f.calls.filter(call=>!call.url.endsWith("/reply")).length,1);
 assert.ok(f.calls.every(call=>!/第\s*\d+\s*轮/.test(call.body.content)));
}));

test("备注事务失败会回滚，后续没有备注的阶段不能读取旧连接上下文",{skip},()=>fixture(async f=>{
 await assert.rejects(f.db.batch([notificationContext(f.db,f.task.id,"不应泄漏的旧备注"),f.db.prepare(`SELECT 1/0`)]));
 await setStage(f.task.id,"running");
 const event=await f.db.prepare(`SELECT detail FROM feishu_stage_events WHERE task_id=? AND stage='running' ORDER BY id DESC LIMIT 1`).bind(f.task.id).first<{detail:string|null}>();
 assert.equal(event?.detail,null);
 await f.drain();assert.ok(f.calls.every(call=>!call.body.content.includes("不应泄漏的旧备注")));
}));
