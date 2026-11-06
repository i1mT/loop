import { readConnection, saveConnection, gatewayUrl } from "./config.ts";
import { LOOPD_VERSION } from "./version.ts";
import { runningPid, startDaemon } from "./process.ts";

export async function connectionCommand(cmd: string | undefined, flag: (name:string)=>string|undefined, dataDir: string): Promise<boolean> {
  if (cmd === "connect" || cmd === "configure") {
    if (runningPid(dataDir)) throw new Error("请先执行 loopd stop，再连接机器；原有会话记录会保留");
    const gateway = gatewayUrl(flag("gateway") ?? "");
    let machineId = flag("machine"); let token = flag("token");
    if (cmd === "connect") {
      const code = flag("code");
      if (!code) throw new Error("请从网站的添加机器窗口复制完整命令");
      const res = await fetch(`${gateway}/api/machines/connect`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code}),signal:AbortSignal.timeout(20000)});
      const data = await res.json() as { machineId?:string;token?:string;error?:string };
      if (!res.ok || !data.machineId || !data.token) throw new Error(data.error ?? "连接失败，请重新生成连接码");
      machineId=data.machineId;token=data.token;
    }
    if (!machineId || !token || !/^lm_[a-f0-9]{64}$/.test(token)) throw new Error("需要有效的机器凭证");
    saveConnection(dataDir,{gateway,token,machineId});
    console.log("机器连接成功，凭证已保存在本机。");
    if (!flag("no-start")) await startDaemon(dataDir);
    return true;
  }
  if (cmd === "start") { await startDaemon(dataDir);return true; }
  if (cmd === "stop") {
    const pid=runningPid(dataDir);
    if (pid) { process.kill(pid,"SIGTERM"); console.log("已请求守护进程停止，请等待正在运行的操作结束。"); }
    else console.log("守护进程没有运行。");
    return true;
  }
  if (cmd === "status") {
    const config=readConnection(dataDir);
    console.log(JSON.stringify({running:!!runningPid(dataDir),machineId:config?.machineId ?? null,gateway:config?.gateway ?? null}));
    return true;
  }
  if (cmd === "--version" || cmd === "version") { console.log(`loopd ${LOOPD_VERSION}`);return true; }
  if (cmd === "--help" || cmd === "help") { console.log("用法：loopd connect --gateway <网站地址> --code <连接码>\nloopd start | stop | status | serve\n先在网站机器页面添加机器；运行任务还需要 git、已登录的代码托管工具与智能体。");return true; }
  return false;
}
