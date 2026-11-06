"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Picker } from "@/components/ui/select.tsx";
import { ApiError, apiPost } from "@/lib/client-api.ts";

type Chat = { id: string; name: string };
export function ChatPicker({
  value,
  name,
  onChange,
  credentials,
  available = true,
  optional = false,
  ariaLabel = "飞书群聊",
}: {
  value: string;
  name?: string | null;
  onChange: (id: string, name: string) => void;
  credentials?: { appId: string; appSecret: string };
  available?: boolean;
  optional?: boolean;
  ariaLabel?: string;
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setChats([]);
    setNext(null);
    setLoaded(false);
    setError(null);
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [credentials?.appId, credentials?.appSecret]);
  async function load(more = false) {
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{
        chats: Chat[];
        nextPageToken: string | null;
      }>("/api/feishu/chats", {
        ...credentials,
        appSecret: credentials?.appSecret || undefined,
        pageToken: more ? next : undefined,
      });
      if (request !== generation.current) return;
      const list = more ? [...chats, ...result.chats] : result.chats;
      setChats([...new Map(list.map((chat) => [chat.id, chat])).values()]);
      setNext(result.nextPageToken);
      setLoaded(true);
      const selected = list.find((chat) => chat.id === value);
      if (selected) onChange(selected.id, selected.name);
    } catch (e) {
      if (request === generation.current)
        setError(
          e instanceof ApiError ? e.message : "无法读取群聊，请稍后重试",
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  const options = [
    {
      value: "none",
      label: optional ? "不设置通知群" : "请选择群聊",
      disabled: !optional,
    },
    ...chats.map((chat) => ({ value: chat.id, label: chat.name })),
  ];
  if (value && !chats.some((chat) => chat.id === value))
    options.push({ value, label: name || "已选择的群聊" });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <Picker
            value={value || "none"}
            onChange={(id) =>
              onChange(
                id === "none" ? "" : id,
                chats.find((chat) => chat.id === id)?.name || "",
              )
            }
            options={options}
            ariaLabel={ariaLabel}
          />
        </div>
        <Button
          size="sm"
          disabled={!available}
          loading={busy}
          onClick={() => void load()}
        >
          {loaded ? "刷新群聊" : "读取群聊"}
        </Button>
      </div>
      {!available ? (
        <p className="text-xs text-ink-2">
          填写 App ID 和 App Secret 后可以读取群聊。
        </p>
      ) : (
        <p className="text-xs text-ink-2">
          飞书群设置 → 群机器人 → 添加机器人，选择这个应用，再读取群聊列表。
        </p>
      )}
      {loaded && !chats.length && (
        <p role="status" className="text-xs text-ink-2">
          还没有找到机器人加入的群。请在飞书群设置中添加这个机器人，然后刷新。
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
      {next && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            onClick={() => void load(true)}
          >
            加载更多群聊
          </Button>
        </div>
      )}
    </div>
  );
}
