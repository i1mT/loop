"use client";
// 任务详情的实时数据：增量拉取会话事件（按 seq 游标），其余字段每次整体替换。
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet } from "./client-api.ts";
import type { Ev, SessionResponse } from "./session-fold.ts";

export interface SessionData extends Omit<SessionResponse, "events"> {
  events: Ev[];
}

export function useSession(taskId: string): { data: SessionData | null; error: ApiError | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const cursor = useRef(-1);
  const alive = useRef(true);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await apiGet<SessionResponse>(`/api/tasks/${taskId}/session?after=${cursor.current}`);
      if (!alive.current) return;
      setError(null);
      if (r.events.length) cursor.current = r.events[r.events.length - 1].seq;
      setData((prev) => ({ ...r, events: [...(prev?.events ?? []), ...r.events] }));
    } catch (e) {
      if (alive.current) setError(e as ApiError);
    } finally {
      busy.current = false;
    }
  }, [taskId]);

  useEffect(() => {
    alive.current = true;
    cursor.current = -1;
    setData(null);
    void poll();
    const t = setInterval(() => document.visibilityState === "visible" && void poll(), 2000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [taskId, poll]);

  return { data, error, loading: !data && !error, reload: () => void poll() };
}
