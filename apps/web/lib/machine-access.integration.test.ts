import { MACHINE_ACCESS_SCHEMA } from "./machine-access/schema.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./pg.ts";
import { migrate } from "./migrations.ts";
import { useDb } from "./db.ts";
import { createPairing, redeemPairing, credentialMachine, hashCredential, revokeMachineCredential } from "./machine-access/credentials.ts";
import { canUseMachine, setMachineSharing } from "./machine-access/policy.ts";
import { authenticateDaemon } from "./machine-access/daemon-auth.ts";
import { machineRequestAllowed } from "./machine-access/request.ts";
import { hello, listMachines } from "./machines.ts";
import { createProject, createTask } from "./tasks.ts";
import { claim, ingestEvents } from "./daemon-api.ts";

const skip = !process.env.DATABASE_URL;
test("机器隔离：一次性接入、双用户/空间、私有与共享、跨机器所有路由、凭证撤销", { skip }, async () => {
  const db = new Db(process.env.DATABASE_URL!);
  await migrate(db); useDb(db);
  const run = crypto.randomUUID();
  const a = `a-${run}`, b = `b-${run}`, s = `s-${run}`, other = `other-${run}`;
  for (const id of [a, b]) await db.prepare(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES (?,? ,?,false,NOW(),NOW())`).bind(id,id,`${id}@example.test`).run();
  for (const id of [s,other]) await db.prepare(`INSERT INTO spaces (id,name,created_at) VALUES (?,?,0)`).bind(id,id).run();
  for (const id of [a,b]) await db.prepare(`INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?,?,'member',0)`).bind(s,id).run();
  const pairing = await createPairing(db,a,s,"我的机器");
  const results = await Promise.all([redeemPairing(db,pairing.code),redeemPairing(db,pairing.code)]);
  assert.equal(results.filter(Boolean).length,1,"并发只能兑换一次");
  const machine = results.find(Boolean)!;
  assert.equal(await credentialMachine(db,machine.token),machine.machineId);
  assert.equal(await credentialMachine(db,"lm_"+"0".repeat(64)),null);
  assert.notEqual((await db.prepare(`SELECT credential_hash FROM machines WHERE id=?`).bind(machine.machineId).first())!.credential_hash,machine.token);
  assert.equal(await redeemPairing(db,pairing.code),null);
  const expired = await createPairing(db,a,s,"过期");
  await db.prepare(`UPDATE machine_pairings SET expires_at=0 WHERE machine_id=?`).bind(expired.machineId).run();
  assert.equal(await redeemPairing(db,expired.code),null);
  assert.equal(await canUseMachine(db,machine.machineId,a,s),true);
  assert.equal(await canUseMachine(db,machine.machineId,b,s),false);
  assert.ok(!(await listMachines(db,s,b)).some(m=>m.id===machine.machineId));
  assert.equal(await setMachineSharing(db,machine.machineId,b,s,true) == null,false);
  assert.equal(await setMachineSharing(db,machine.machineId,a,s,true),null);
  assert.equal(await canUseMachine(db,machine.machineId,b,s),true);
  assert.equal(await canUseMachine(db,machine.machineId,b,s,true),false);
  assert.equal(await canUseMachine(db,machine.machineId,b,other),false);
  const agents = [{kind:"grok",installed:true,version:"test",acp:true,note:null}];
  await hello(db,{machineId:machine.machineId,agents});
  const project = await createProject({name:"测试项目",machineId:machine.machineId,agent:"grok",githubRepo:"fixture/fixture",spaceId:s});
  const task = await createTask({projectId:project.id,title:"测试任务"});
  const lease = (await claim(machine.machineId))!;
  const sid = `session-${run}`;
  const eventReq = (suffix:string,body:unknown,method="POST")=>new Request(`https://fixture/api/daemon/${suffix}`,{method,...(method==="GET"?{}:{body:JSON.stringify(body)})});
  const check = (suffix:string,body:unknown,token=machine.token,method="POST")=>authenticateDaemon(db,eventReq(suffix,body,method),token,"legacy");
  assert.equal(await check("hello",{machineId:machine.machineId}),true);
  assert.equal(await check("claim",{daemonId:"another"}),false);
  assert.equal(await check("claim",{machineId:machine.machineId,daemonId:"another"}),false,"所有身份字段必须一致");
  assert.equal(await check("hello",{machineId:"another"}),false);
  assert.equal(await check(`sessions/${sid}/events`,{daemonId:machine.machineId,leaseId:lease.leaseId}),true,"首次会话通过租约认证");
  await ingestEvents(sid,lease.leaseId,machine.machineId,[]);
  await db.prepare(`INSERT INTO inbox (session_id,kind,body,created_at) VALUES (?,'message','hello',0)`).bind(sid).run();
  const inbox = (await db.prepare(`SELECT id FROM inbox WHERE session_id=?`).bind(sid).first<{id:number}>())!;
  const secondPairing = await createPairing(db,b,s,"另一台机器");
  const second = (await redeemPairing(db,secondPairing.code))!;
  for (const [suffix,body,method] of [
    [`leases/${lease.leaseId}/heartbeat`,{daemonId:machine.machineId},"POST"],
    [`sessions/${sid}/inbox`,{},"GET"],
    [`sessions/${sid}/head`,{daemonId:machine.machineId,leaseId:lease.leaseId},"POST"],
    [`inbox/${inbox.id}/ack`,{},"POST"],
    [`tasks/${task.id}/technical-plan`,{},"GET"],
  ] as const) {
    assert.equal(await check(suffix,body,machine.token,method),true,suffix);
    assert.equal(await check(suffix,body,second.token,method),false,`跨机器拒绝 ${suffix}`);
    assert.equal(await check(suffix,body,"legacy",method),false,`旧令牌不能访问新机器 ${suffix}`);
  }
  assert.equal(await check("hello",{machineId:"unknown"},"legacy"),false);
  assert.equal(await setMachineSharing(db,machine.machineId,a,s,false),null,"绑定项目仍允许所有者撤回共享");
  assert.equal(await canUseMachine(db,machine.machineId,a,s),true);
  assert.equal(await canUseMachine(db,machine.machineId,b,s),false);
  await db.prepare(`UPDATE space_machines SET shared=0 WHERE machine_id=?`).bind(machine.machineId).run();
  const request = (url:string,body:unknown={})=>new Request(`https://fixture/api/${url}`,{method:"POST",body:JSON.stringify(body)});
  assert.equal(await machineRequestAllowed(db,request("tasks",{projectId:project.id}),b,s),false);
  assert.equal(await machineRequestAllowed(db,request(`tasks/${task.id}/reply`),b,s),false);
  assert.equal(await machineRequestAllowed(db,request(`projects/${project.id}/pool/flush`),b,s),false);
  assert.equal(await machineRequestAllowed(db,request("projects",{machineId:machine.machineId}),b,s),false);
  assert.equal(await machineRequestAllowed(db,request(`machines/${machine.machineId}/refresh-models`),b,s),false);
  assert.equal(await machineRequestAllowed(db,request("tasks",{projectId:project.id}),a,s),true);
  assert.equal(await machineRequestAllowed(db,request("feishu/settings",{defaultProjectId:project.id}),b,s),false,"飞书配置不能间接使用他人独享机器");
  assert.equal(await machineRequestAllowed(db,request("feishu/routes",{projectId:project.id}),b,s),false);
  assert.equal(await machineRequestAllowed(db,new Request(`https://fixture/api/projects/${project.id}/sdk`),b,s),false,"不能读取私有项目的 SDK 凭证");
  await assert.rejects(()=>createProject({name:"撤回后不能绑定",machineId:machine.machineId,agent:"grok",githubRepo:"fixture/fixture",spaceId:s,actorId:b}),/使用权限/);
  await db.prepare(`UPDATE machines SET credential_hash=?,legacy_auth=0 WHERE id=?`).bind(await hashCredential(second.token+"rotated"),machine.machineId).run();
  assert.equal(await credentialMachine(db,machine.token),null,"撤销立即生效");
  await assert.rejects(()=>createTask({projectId:project.id,title:"不能绕过创建",actorId:b}),/使用权限/);
  for (let i=0;i<3;i++) {
    const racePair=await createPairing(db,a,s,"并发共享");
    const race=(await redeemPairing(db,racePair.code))!;
    await hello(db,{machineId:race.machineId,agents});
    await setMachineSharing(db,race.machineId,a,s,true);
    const [revocation,binding]=await Promise.allSettled([
      setMachineSharing(db,race.machineId,a,s,false),
      createProject({name:"并发绑定",machineId:race.machineId,agent:"grok",githubRepo:"fixture/fixture",spaceId:s,actorId:b}),
    ]);
    const usable=await canUseMachine(db,race.machineId,b,s);
    assert.equal(usable,false,"撤回之后成员没有使用权限");
    assert.equal(revocation.status,"fulfilled");
    if(binding.status==="fulfilled") await assert.rejects(()=>createTask({projectId:binding.value.id,title:"撤回后禁止执行",actorId:b}),/使用权限/);
    else assert.match(String(binding.reason),/使用权限/);
  }
  const reconnect=await createPairing(db,a,s,"重连",machine.machineId);
  const restored=await redeemPairing(db,reconnect.code);
  assert.equal(restored?.machineId,machine.machineId,"重连保留机器 ID");
  assert.equal(await credentialMachine(db,restored!.token),machine.machineId);
  assert.equal((await listMachines(db,s,a)).find(m=>m.id===machine.machineId)?.name,"我的机器","hello 与重连保留用户命名");
  const revokeCode=await createPairing(db,b,s,"撤销重连",second.machineId);
  await revokeMachineCredential(db,second.machineId,b);
  assert.equal(await redeemPairing(db,revokeCode.code),null,"断开同时废止待兑换连接码");
  await db.batch(MACHINE_ACCESS_SCHEMA.map(sql=>db.prepare(sql)));
  assert.equal(await credentialMachine(db,restored!.token),machine.machineId,"重放迁移不能更换独立凭证或所有权");
  assert.equal(await canUseMachine(db,machine.machineId,b,s),false,"重放迁移不能把独享机器改成共享");
  const {registerHooks}=await import("node:module");
  process.env.LOOP_ADMIN_TOKEN="fixture-admin";process.env.LOOP_DAEMON_TOKEN="legacy";
  const hook=registerHooks({resolve(specifier,context,next){
    if(specifier.startsWith("@/"))return next(new URL("../"+specifier.slice(2),import.meta.url).href,context);
    if(specifier==="cloudflare:workers")return {url:"data:text/javascript,export const env=process.env",shortCircuit:true};
    return next(specifier,context);
  }});
  try {
    const claimRoute=await import("../app/api/daemon/claim/route.ts");
    const response=await claimRoute.POST(new Request("https://fixture/api/daemon/claim",{method:"POST",headers:{authorization:`Bearer ${restored!.token}`},body:JSON.stringify({machineId:machine.machineId,daemonId:second.machineId})}));
    assert.equal(response.status,401,"真实 claim 路由拒绝双身份绕过");
    const sdkRoute=await import("../app/api/projects/[id]/sdk/route.ts");
    const sdkResponse=await sdkRoute.GET(new Request(`https://fixture/api/projects/${project.id}/sdk`,{headers:{authorization:"Bearer fixture-admin","x-loop-user":`${b}@example.test`,"x-loop-space":s}}),{params:Promise.resolve({id:project.id})});
    assert.equal(sdkResponse.status,403,"真实 SDK 设置路由拒绝独享项目凭证读取");
  } finally {hook.deregister();}

});
