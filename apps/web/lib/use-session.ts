"use client";
// 任务详情的实时数据：首屏只取最新一页，向上滚动时再翻更早的事件。
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet } from "./client-api.ts";
import type { Ev, SessionResponse } from "./session-fold.ts";

export interface SessionData extends Omit<SessionResponse, "events"> {
  events: Ev[];
}

const PAGE = 120;

export function useSession(taskId: string): {
  data: SessionData | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
} {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursor = useRef(-1);
  const first = useRef<number | null>(null);
  const initialized = useRef(false);
  const alive = useRef(true);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const initial = !initialized.current;
      const r = await apiGet<SessionResponse>(
        `/api/tasks/${taskId}/session${initial ? `?limit=${PAGE}` : `?after=${cursor.current}`}`,
      );
      if (!alive.current) return;
      initialized.current = true;
      setError(null);
      if (r.events.length) {
        cursor.current = Math.max(cursor.current, r.events[r.events.length - 1].seq);
        first.current ??= r.events[0].seq;
      }
      if (initial) setHasMore(!!r.hasMore);
      setData((prev) => ({
        ...r,
        events: initial ? r.events : [...(prev?.events ?? []), ...r.events],
      }));
    } catch (e) {
      if (alive.current) setError(e as ApiError);
    } finally {
      busy.current = false;
    }
  }, [taskId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || first.current === null) return;
    setLoadingOlder(true);
    try {
      const r = await apiGet<SessionResponse>(
        `/api/tasks/${taskId}/session?before=${first.current}&limit=${PAGE}`,
      );
      if (!alive.current) return;
      setData((prev) => {
        if (!prev) return prev;
        const existing = new Set(prev.events.map((e) => e.seq));
        const older = r.events.filter((e) => !existing.has(e.seq));
        if (older.length) first.current = older[0].seq;
        return { ...prev, events: [...older, ...prev.events] };
      });
      setHasMore(!!r.hasMore);
    } catch (e) {
      if (alive.current) setError(e as ApiError);
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }, [taskId, hasMore, loadingOlder]);

  useEffect(() => {
    alive.current = true;
    cursor.current = -1;
    first.current = null;
    initialized.current = false;
    setData(null);
    setHasMore(false);
    setLoadingOlder(false);
    void poll();
    const t = setInterval(() => document.visibilityState === "visible" && void poll(), 2000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [taskId, poll]);

  return {
    data,
    error,
    loading: !data && !error,
    reload: () => void poll(),
    hasMore,
    loadingOlder,
    loadOlder: () => void loadOlder(),
  };
}
