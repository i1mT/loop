import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatewayUrl, readConnection, saveConnection } from "./connection/config.ts";
import { lockDaemon, runningPid } from "./connection/process.ts";

test("机器连接配置：接受 HTTP 网关、拒绝凭证与子路径、私有保存与进程互斥", () => {
  const dir=mkdtempSync(join(tmpdir(),"loop-connection-"));
  try {
    assert.equal(readConnection(dir),null);
    assert.equal(gatewayUrl("https://example.test/"),"https://example.test");
    // 自建网关常用 HTTP + IP，协议不该被限制；只有真正有害的写法才拒绝。
    assert.equal(gatewayUrl("http://118.196.30.108:3220"),"http://118.196.30.108:3220");
    assert.equal(gatewayUrl("http://example.test/api"),"http://example.test");
    for (const value of ["https://user:pw@example.test","file:///tmp/test"]) assert.throws(()=>gatewayUrl(value));
    const config={gateway:"https://example.test",machineId:"m-test",token:"lm_test"};
    saveConnection(dir,config);
    assert.deepEqual(readConnection(dir),config);
    assert.equal(statSync(join(dir,"connection.json")).mode&0o777,0o600);
    saveConnection(dir,{...config,token:"lm_updated"});
    assert.equal(JSON.parse(readFileSync(join(dir,"connection.json"),"utf8")).token,"lm_updated");
    const unlock=lockDaemon(dir);
    assert.equal(runningPid(dir),process.pid);
    assert.throws(()=>lockDaemon(dir),/已经运行/);
    unlock();assert.equal(runningPid(dir),null);
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test("多个进程同时启动只有一个取得会话目录锁", async () => {
  const {spawn}=await import("node:child_process");
  const dir=mkdtempSync(join(tmpdir(),"loop-lock-race-"));
  const moduleUrl=new URL("./connection/process.ts",import.meta.url).href;
  const code=`import {lockDaemon} from ${JSON.stringify(moduleUrl)}; try {const release=lockDaemon(${JSON.stringify(dir)});console.log("LOCKED");setTimeout(()=>{release();process.exit(0)},1500)} catch {console.log("BLOCKED")}`;
  try {
    const outputs=await Promise.all(Array.from({length:8},()=>new Promise<string>((resolve,reject)=>{
      const child=spawn(process.execPath,["--experimental-strip-types","--input-type=module","--eval",code]);let output="";
      child.stdout.on("data",data=>output+=data);child.once("error",reject);child.once("exit",status=>status===0?resolve(output):reject(new Error("锁测试子进程失败")));
    })));
    assert.equal(outputs.filter(value=>value.trim()==="LOCKED").length,1);
    assert.equal(outputs.filter(value=>value.trim()==="BLOCKED").length,7);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
