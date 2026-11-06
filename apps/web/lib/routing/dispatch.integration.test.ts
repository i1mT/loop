import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../pg.ts";
import { migrate } from "../migrations.ts";
import { useDb } from "../db.ts";
import { hello, deleteMachine } from "../machines.ts";
import { createProject, createTask, getProject, updateProject, listProjects } from "../tasks.ts";
import { claim } from "../daemon-api.ts";
import { setMachineSharing } from "../machine-access/policy.ts";
import { machineRequestAllowed } from "../machine-access/request.ts";
import { canUseProject } from "./access.ts";

const skip=!process.env.DATABASE_URL;
const agent={kind:"grok",installed:true,version:"fixture",acp:true,note:null};
async function setup(count=3){
 const db=new Db(process.env.DATABASE_URL!);await migrate(db);useDb(db);
 const key=crypto.randomUUID().slice(0,8), spaceId=`route-space-${key}`,user=`route-user-${key}`;
 await db.prepare(`INSERT INTO spaces(id,name,created_at) VALUES(?,?,0)`).bind(spaceId,spaceId).run();
 const machines=Array.from({length:count},(_,index)=>`route-${key}-${index}`);
 for(const id of machines){await hello(db,{machineId:id,agents:[agent]});await db.prepare(`UPDATE machines SET owner_user_id=? WHERE id=?`).bind(user,id).run();}
 const project=await createProject({name:"多机器",agent:"grok",githubRepo:"fixture/route",spaceId,actorId:user,bindings:machines.map((machineId,index)=>({machineId,localPath:`/fixture/${index}`,agent:"grok"}))});
 return {db,machines,project,user,spaceId};
}
test("分配：三个并发任务分别预留三台空闲机器；全部忙时持久轮询",{skip},async()=>{
 const {db,machines,project,user}=await setup();
 const tasks=await Promise.all(machines.map((_,i)=>createTask({projectId:project.id,title:`并发${i}`,actorId:user})));
 assert.deepEqual(tasks.map(task=>task.machine_id).sort(),machines.slice().sort());
 const next=[];for(let i=0;i<4;i++)next.push((await createTask({projectId:project.id,title:`轮询${i}`,actorId:user})).machine_id);
 assert.deepEqual(next,[machines[0],machines[1],machines[2],machines[0]]);
 const cursor=(await getProject(project.id))!.dispatch_cursor;
 await createTask({projectId:project.id,title:"同一请求",actorId:user},{id:tasks[0].id});
 assert.equal((await getProject(project.id))!.dispatch_cursor,cursor,"幂等请求不能推进游标");
 const before=(await db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id=?`).bind(project.id).first<{n:number}>())!.n;
 await assert.rejects(()=>createTask({projectId:project.id,title:"回滚",actorId:user},{statements:[db.prepare(`SELECT 1/0`)]}));
 assert.equal((await getProject(project.id))!.dispatch_cursor,cursor,"失败事务回滚游标");
 assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id=?`).bind(project.id).first<{n:number}>())!.n,before);
});
test("空闲优先于轮询；在线忙碌优先于离线；审核等待不占用机器",{skip},async()=>{
 const {db,machines,project,user}=await setup();
 const first=await createTask({projectId:project.id,title:"第一条",actorId:user});assert.equal(first.machine_id,machines[0]);
 await db.prepare(`UPDATE machines SET last_seen=0 WHERE id=?`).bind(machines[1]).run();
 const second=await createTask({projectId:project.id,title:"第二条",actorId:user});assert.equal(second.machine_id,machines[2]);
 await db.prepare(`UPDATE tasks SET stage='reviewing' WHERE id=?`).bind(first.id).run();
 const third=await createTask({projectId:project.id,title:"审核期间",actorId:user});assert.equal(third.machine_id,machines[0]);
 const fourth=await createTask({projectId:project.id,title:"在线都忙",actorId:user});assert.notEqual(fourth.machine_id,machines[1]);
 await db.prepare(`UPDATE machines SET last_seen=0 WHERE id IN (?,?,?)`).bind(...machines).run();
 await db.prepare(`UPDATE projects SET dispatch_cursor=0 WHERE id=?`).bind(project.id).run();
 assert.equal((await createTask({projectId:project.id,title:"离线等待一",actorId:user})).machine_id,machines[0]);
 assert.equal((await createTask({projectId:project.id,title:"离线等待二",actorId:user})).machine_id,machines[1]);
});
test("目录和模型按选中机器固定；更换绑定后领取仍使用原快照",{skip},async()=>{
 const {db,machines,project,user}=await setup(2);
 await db.prepare(`UPDATE machine_agents SET default_model='fixture-model',default_effort='high' WHERE machine_id=?`).bind(machines[0]).run();
 const task=await createTask({projectId:project.id,title:"路径快照",actorId:user});
 assert.equal(task.execution_path,"/fixture/0");assert.equal(task.model,"fixture-model");assert.equal(task.effort,"high");
 await updateProject(project.id,{bindings:[{machineId:machines[1],localPath:"/changed",agent:"grok"}]},user);
 const taken=await claim(machines[0]);assert.equal(taken?.task.id,task.id);assert.equal(taken?.task.repoPath,"/fixture/0");
 const next=await createTask({projectId:project.id,title:"新目录",actorId:user});assert.equal(next.machine_id,machines[1]);assert.equal(next.execution_path,"/changed");
});
test("每台绑定机器可以用不同智能体；绑定上的模型/思考程度覆盖优先于机器默认",{skip},async()=>{
 const {db,machines,project,user}=await setup(2);
 await hello(db,{machineId:machines[0],agents:[{...agent,models:[{value:"grok-4.7",name:"Grok 4.7"},{value:"grok-4.5",name:"Grok 4.5"}],efforts:[{value:"high",name:"High"},{value:"low",name:"Low"}]}]});
 await hello(db,{machineId:machines[1],agents:[{kind:"claude",installed:true,version:"fixture",acp:true,note:null}]});
 await db.prepare(`UPDATE machine_agents SET default_model='grok-4.7',default_effort='high' WHERE machine_id=? AND kind='grok'`).bind(machines[0]).run();
 await db.prepare(`UPDATE machine_agents SET default_model='opus',default_effort='high' WHERE machine_id=? AND kind='claude'`).bind(machines[1]).run();
 await updateProject(project.id,{bindings:[
  {machineId:machines[0],localPath:"/a",agent:"grok",model:"grok-4.5",effort:"low"},
  {machineId:machines[1],localPath:"/b",agent:"claude"},
 ]},user);
 const first=await createTask({projectId:project.id,title:"第一台",actorId:user});
 assert.deepEqual([first.machine_id,first.agent,first.model,first.effort,first.execution_path],[machines[0],"grok","grok-4.5","low","/a"]);
 const second=await createTask({projectId:project.id,title:"第二台",actorId:user});
 assert.deepEqual([second.machine_id,second.agent,second.model,second.effort,second.execution_path],[machines[1],"claude","opus","high","/b"]);
 // 创建任务时显式换智能体：只找安装了它的机器，并使用机器默认配置（不沿用其他绑定的模型覆盖）。
 const third=await createTask({projectId:project.id,title:"换智能体",actorId:user,agent:"claude"});
 assert.deepEqual([third.machine_id,third.agent,third.model,third.effort],[machines[1],"claude","opus","high"]);
 // 每行智能体必须是那台机器上可用的；模型也要在该智能体的列表里。
 await assert.rejects(()=>updateProject(project.id,{bindings:[{machineId:machines[0],localPath:"/a",agent:"claude"}]},user),/没有安装/);
 await assert.rejects(()=>updateProject(project.id,{bindings:[{machineId:machines[0],localPath:"/a",agent:"grok",model:"nope"}]},user),/没有模型/);
 const view=(await getProject(project.id))!;
 assert.deepEqual(view.bindings?.map(row=>row.agent),["grok","claude"],"失败的修改不能覆盖已有绑定");
});
test("私有过滤：第二台机器授权、隐藏目录保护、集成与公共配置拒绝编码绕过",{skip},async()=>{
 const {db,machines,project,user,spaceId}=await setup(2);const member=user+'-member';
 await setMachineSharing(db,machines[1],user,spaceId,true);
 assert.equal(await canUseProject(db,project.id,member,spaceId),true);
 assert.equal(await canUseProject(db,project.id,null,spaceId),false);
 await db.prepare(`UPDATE projects SET repo_path='/private/owner/legacy' WHERE id=?`).bind(project.id).run();
 const view=(await listProjects(false,spaceId,member)).find(row=>row.id===project.id)!;
 assert.equal(view.bindings?.length,1);assert.equal(view.machine_id,machines[1]);assert.equal(view.local_path,"/fixture/1");
 assert.equal(view.repo_path,"/fixture/1");assert.equal(view.canManage,false);
 for(const path of [`/api/projects/${project.id}/sdk`,`/api/projects/${project.id}/api-keys`,`/api/projects/${project.id}/%73dk`,`/api/projects/${project.id}/api%2dkeys`,`/api/%70rojects/${project.id}/sdk`,`/api//projects/${project.id}/sdk`]){
  assert.equal(await machineRequestAllowed(db,new Request('https://fixture'+path),member,spaceId),false,path);
 }
 await assert.rejects(()=>updateProject(project.id,{instructions:"不应影响私有机器"},member),/权限/);
 for(let i=0;i<3;i++)assert.equal((await createTask({projectId:project.id,title:"成员请求",actorId:member})).machine_id,machines[1]);
 await updateProject(project.id,{bindings:[{machineId:machines[1],localPath:"/member/path",agent:"grok"}]},member);
 assert.equal((await getProject(project.id))!.bindings?.length,2,"保留不可见绑定");
 // 调用真正的 route handler，验证编码后的静态段仍然进入完整项目权限检查。
 await db.prepare(`INSERT INTO "user"(id,name,email) VALUES(?,?,?)`).bind(member,"调度测试成员",member+'@example.test').run();
 await db.prepare(`INSERT INTO space_members(space_id,user_id,role,created_at) VALUES(?,?,'member',0)`).bind(spaceId,member).run();
 const {registerHooks}=await import('node:module');process.env.LOOP_ADMIN_TOKEN='fixture-routing-admin';
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier==="cloudflare:workers")return {url:"data:text/javascript,export const env=process.env",shortCircuit:true};if(specifier.startsWith('@/'))return next(new URL('../../'+specifier.slice(2),import.meta.url).href,context);return next(specifier,context);}});
 try{
  const headers={authorization:'Bearer fixture-routing-admin','x-loop-user':member+'@example.test','x-loop-space':spaceId,'content-type':'application/json'};
  const sdk=await import('../../app/api/projects/[id]/sdk/route.ts');
  const keys=await import('../../app/api/projects/[id]/api-keys/route.ts');
  const details=await import('../../app/api/projects/[id]/route.ts');
  const params={params:Promise.resolve({id:project.id})};
  for(const path of [`/api/projects/${project.id}/sdk`,`/api/projects/${project.id}/%73dk`,`/api/%70rojects/${project.id}/sdk`,`/api//projects/${project.id}/sdk`])assert.equal((await sdk.GET(new Request('https://fixture'+path,{headers}),params)).status,403,path);
  assert.equal((await keys.POST(new Request(`https://fixture/api/projects/${project.id}/api%2dkeys`,{method:'POST',headers,body:JSON.stringify({name:'不得创建的密钥'})}),params)).status,403);
  const edited=await details.PATCH(new Request(`https://fixture/api/projects/${project.id}`,{method:'PATCH',headers,body:JSON.stringify({instructions:'不得修改的公共指令'})}),params);
  assert.equal(edited.status,403);assert.equal((await getProject(project.id))!.instructions,null);
 }finally{hooks.deregister();}
 await setMachineSharing(db,machines[1],user,spaceId,false);
 assert.equal(await canUseProject(db,project.id,member,spaceId),false);
 await assert.rejects(()=>createTask({projectId:project.id,title:"已撤回",actorId:member}),/使用权限/);
});

test("跨项目共享机器的占用参与调度；旧单机器字段仍兼容",{skip},async()=>{
 const {machines,project,user,spaceId}=await setup(2);
 const legacy=await createProject({name:"旧入口",machineId:machines[0],agent:"grok",githubRepo:"fixture/legacy",spaceId,actorId:user});
 await createTask({projectId:legacy.id,title:"另一个项目正在排队",actorId:user});
 assert.equal((await createTask({projectId:project.id,title:"选择真正空闲的机器",actorId:user})).machine_id,machines[1]);
});

test("删除机器在事务锁内重新核验绑定；删除完成后不能重新绑定",{skip},async()=>{
 const {db,machines,project,user,spaceId}=await setup(2);
 await updateProject(project.id,{bindings:[{machineId:machines[1],localPath:null,agent:"grok"}]},user);
 await db.prepare(`UPDATE machines SET last_seen=0 WHERE id=?`).bind(machines[0]).run();
 const originalBatch=db.batch.bind(db);let interleaved=false;
 db.batch=async statements=>{
  if(!interleaved&&statements.some(statement=>statement.sql.includes("DELETE FROM machines"))){
   interleaved=true;
   await createProject({name:"并发绑定",agent:"grok",githubRepo:"fixture/route",spaceId,actorId:user,bindings:[{machineId:machines[0],localPath:null,agent:"grok"}]});
  }
  return originalBatch(statements);
 };
 const refused=await deleteMachine(db,machines[0]);assert.equal(refused.ok,false);assert.ok(interleaved);
 assert.ok(await db.prepare(`SELECT id FROM machines WHERE id=?`).bind(machines[0]).first());
 db.batch=originalBatch;
 const orphan=`deleted-${crypto.randomUUID()}`;await hello(db,{machineId:orphan,agents:[agent]});
 await db.prepare(`UPDATE machines SET owner_user_id=?,last_seen=0 WHERE id=?`).bind(user,orphan).run();
 assert.equal((await deleteMachine(db,orphan)).ok,true);
 await assert.rejects(()=>createProject({name:"删除后绑定",agent:"grok",githubRepo:"fixture/route",spaceId,actorId:user,bindings:[{machineId:orphan,localPath:null,agent:"grok"}]}));
});
