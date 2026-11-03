"use client";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate } from "@/lib/client-api.ts";

/**
 * “刷新模型列表”：请求机器重新探测，然后轮询机器信息，直到上报新的列表（或失败、超时）。
 * 守护进程在下一次与网关同步时（最多约 1 分钟）拿到请求。
 */
export function useModelRefresh(machineId: string, agent: string, modelsAt: number | null, pending: boolean, probeError: string | null) {
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const before = useRef<number | null>(null);
  const sawPending = useRef(false);
  const startedAt = useRef(0);

  function start() {
    setError(null);
    apiPost(`/api/machines/${machineId}/refresh-models`, { agent })
      .then(() => {
        before.current = modelsAt;
        sawPending.current = false;
        startedAt.current = Date.now();
        setWaiting(true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "请求失败"));
  }

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => mutate("/api/machines"), 3000);
    return () => clearInterval(t);
  }, [waiting]);

  useEffect(() => {
    if (!waiting) return;
    if (pending) sawPending.current = true;
    const updated = modelsAt !== null && modelsAt !== before.current;
    if (probeError) {
      setWaiting(false);
      setError(probeError);
    } else if (updated || (sawPending.current && !pending)) {
      setWaiting(false);
      toast("ok", "模型列表已更新");
    } else if (Date.now() - startedAt.current > 150_000) {
      setWaiting(false);
      setError("等待超时：机器可能离线，或守护进程还没来得及同步。稍后再试。");
    }
  }, [waiting, pending, modelsAt, probeError, toast]);

  return { waiting, error, start };
}
