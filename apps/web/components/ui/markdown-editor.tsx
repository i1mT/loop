"use client";
import clsx from "clsx";
import { ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { request } from "@/lib/client-api.ts";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** 上传一张图片，返回可写进 Markdown 的链接 */
async function uploadImage(file: File): Promise<string> {
  const r = await request<{ url: string }>("/api/uploads", { method: "POST", body: file, headers: { "content-type": file.type } });
  return r.url;
}

/**
 * Markdown 编辑器：「编写 / 预览」两个标签；可粘贴剪贴板里的图片、拖入图片、点按钮选图片，
 * 上传期间先插入占位文字，完成后换成图片链接。
 */
export function MarkdownEditor({ value, onChange, id, placeholder, onError }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string; onError?: (message: string) => void }) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [pending, setPending] = useState(0);
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // 上传是异步的，用 ref 取最新正文再替换占位符，避免覆盖期间的输入
  const latest = useRef(value);
  latest.current = value;

  function insertAtCursor(text: string) {
    const el = ta.current;
    const v = latest.current;
    const at = el ? el.selectionStart : v.length;
    const end = el ? el.selectionEnd : v.length;
    const next = v.slice(0, at) + text + v.slice(end);
    latest.current = next;
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  }

  async function addImages(files: File[]) {
    for (const f of files) {
      if (!IMAGE_TYPES.includes(f.type)) {
        onError?.("只支持 PNG、JPEG、GIF、WebP 图片");
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        onError?.(`图片 ${f.name || ""} 超过 5MB`);
        continue;
      }
      const token = `![上传中 ${Math.random().toString(36).slice(2, 7)}…]()`;
      insertAtCursor(`${token}\n`);
      setPending((n) => n + 1);
      try {
        const url = await uploadImage(f);
        const alt = (f.name || "图片").replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "");
        latest.current = latest.current.replace(token, `![${alt}](${url})`);
        onChange(latest.current);
      } catch (e) {
        latest.current = latest.current.replace(`${token}\n`, "").replace(token, "");
        onChange(latest.current);
        onError?.(e instanceof Error ? e.message : "图片上传失败");
      } finally {
        setPending((n) => n - 1);
      }
    }
  }

  const imagesOf = (list: DataTransferItemList | FileList | undefined): File[] => {
    if (!list) return [];
    const out: File[] = [];
    for (const it of Array.from(list as ArrayLike<DataTransferItem | File>)) {
      const f = it instanceof File ? it : it.kind === "file" ? it.getAsFile() : null;
      if (f && f.type.startsWith("image/")) out.push(f);
    }
    return out;
  };

  const writeCls = tab === "write" ? "flex" : "hidden lg:flex";
  const previewCls = tab === "preview" ? "block" : "hidden lg:block";
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <div role="tablist" aria-label="编辑模式" className="flex lg:hidden">
          {(
            [
              ["write", "编写"],
              ["preview", "预览"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={clsx("-mb-px h-9 cursor-pointer border-b-2 px-3 text-[13px] font-medium transition-colors", tab === k ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hidden text-xs text-ink-3 lg:block">Markdown · 粘贴或拖入图片即可上传 · 右侧实时预览</p>
        <div className="flex items-center gap-2 text-xs text-ink-2">
          {pending > 0 && (
            <span className="inline-flex items-center gap-1" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              上传图片中…
            </span>
          )}
          <button type="button" onClick={() => picker.current?.click()} className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-control px-2 text-ink-2 hover:bg-sunken hover:text-ink">
            <ImagePlus className="size-4" aria-hidden />
            插入图片
          </button>
          <input
            ref={picker}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            hidden
            aria-label="选择图片"
            onChange={(e) => {
              void addImages(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-2 lg:divide-x lg:divide-line">
        <div
          className={clsx("relative min-h-0 min-w-0 flex-1", writeCls)}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            const files = imagesOf(e.dataTransfer.files);
            setDragging(false);
            if (files.length) {
              e.preventDefault();
              void addImages(files);
            }
          }}
        >
          <textarea
            ref={ta}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const files = imagesOf(e.clipboardData.items);
              if (files.length) {
                e.preventDefault();
                void addImages(files);
              }
            }}
            placeholder={placeholder}
            spellCheck={false}
            className="block h-full w-full resize-none bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
          />
          {dragging && <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-card border-2 border-dashed border-signal bg-card/80 text-sm text-ink">松开即可上传图片</div>}
        </div>
        <div className={clsx("md min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4 text-sm", previewCls)}>
          {value.trim() ? <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown> : <p className="text-ink-3">没有内容可预览</p>}
        </div>
      </div>
    </div>
  );
}
