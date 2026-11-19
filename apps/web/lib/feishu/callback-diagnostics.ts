export type CallbackStage =
  | "params"
  | "database"
  | "binding"
  | "body"
  | "runtime"
  | "unseal"
  | "decode"
  | "app"
  | "challenge"
  | "filter"
  | "tenant"
  | "enqueue";

// 仅输出固定字段；绝不传入请求、凭证、事件正文或异常文本。
export async function withCallbackDiagnostics(
  handle: (stage: (value: CallbackStage) => void) => Promise<Response>,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  let stage: CallbackStage = "params";
  let status = 500;
  const log = (event: "received" | "slow" | "completed") => {
    try {
      console.info(JSON.stringify({
        event: `feishu_callback_${event}`,
        requestId,
        stage,
        ...(event === "completed" ? { status } : {}),
        ...(event !== "received"
          ? { durationMs: Math.max(0, Math.round(performance.now() - started)) }
          : {}),
      }));
    } catch {
      // 诊断日志不可影响回调应答。
    }
  };
  log("received");
  // 地址验证要求快速应答；只在超过一秒时记录当前阶段，不中断原处理。
  const slowTimer = setTimeout(() => log("slow"), 1000);
  slowTimer.unref?.();
  try {
    const response = await handle((value) => { stage = value; });
    status = response.status;
    return response;
  } finally {
    clearTimeout(slowTimer);
    log("completed");
  }
}
