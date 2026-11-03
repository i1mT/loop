import { toCanvas } from "html-to-image";
import type { ElementInfo } from "./types";

export const HOST_ID = "loop-feedback-host";

const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function pageBackground(): string {
  for (const el of [document.body, document.documentElement]) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
  }
  return "#ffffff";
}

const filter = (n: Node) => !(n instanceof Element && n.id === HOST_ID);

async function render(node: HTMLElement, extra: Parameters<typeof toCanvas>[1]): Promise<HTMLCanvasElement> {
  const base = { filter, imagePlaceholder: BLANK, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), backgroundColor: pageBackground(), ...extra };
  try {
    return await toCanvas(node, base);
  } catch {
    // 跨域字体/样式表读取失败时，跳过字体再试一次
    return await toCanvas(node, { ...base, skipFonts: true });
  }
}

/** 截取当前可视区域 */
export function screenshotViewport(): Promise<HTMLCanvasElement> {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return render(document.body, {
    width: w,
    height: h,
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`, transformOrigin: "top left", margin: "0" },
  });
}

export function screenshotElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  return render(el, {});
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/jpeg", q = 0.88): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("导出图片失败"))), type, q));
}

/** 缩放到最长边不超过 max，并压成 JPEG（GIF 原样保留） */
export async function normalizeImage(blob: Blob, max = 1800): Promise<Blob> {
  if (blob.type === "image/gif") return blob;
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // 透明 PNG 转 JPEG 时垫白底
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return canvasToBlob(c, "image/jpeg", 0.88);
}

// ---------- 元素选择与描述 ----------

const esc = (s: string) => (typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy");
  if (testId) return `${tag}[data-testid="${testId}"]`;
  const classes = [...el.classList].filter((c) => c.length < 30 && !/^\d|[:/[\]]/.test(c)).slice(0, 2);
  let s = tag + classes.map((c) => "." + esc(c)).join("");
  const parent = el.parentElement;
  if (parent) {
    const same = [...parent.children].filter((c) => c.tagName === el.tagName);
    if (same.length > 1 && (classes.length === 0 || [...parent.querySelectorAll(":scope > " + s)].length > 1)) {
      s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
  }
  return s;
}

export function cssSelector(el: Element): string {
  if (el.id && !/^\d|[:]/.test(el.id) && document.querySelectorAll("#" + esc(el.id)).length === 1) return "#" + esc(el.id);
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement && parts.length < 6) {
    parts.unshift(segment(cur));
    const sel = parts.join(" > ");
    try {
      if (document.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* 非法选择器继续向上 */
    }
    if (cur.id && document.querySelectorAll("#" + esc(cur.id)).length === 1) {
      parts[0] = "#" + esc(cur.id);
      return parts.join(" > ");
    }
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

export function describeElement(el: Element): ElementInfo {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const attrs: Record<string, string> = {};
  for (const a of ["id", "class", "href", "src", "role", "aria-label", "type", "name", "placeholder", "alt", "title", "disabled"]) {
    const v = el.getAttribute(a);
    if (v !== null) attrs[a] = v.slice(0, 200);
  }
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("input,textarea").forEach((i) => i.removeAttribute("value")); // 不带出表单内容
  const path: string[] = [];
  for (let c: Element | null = el; c && c !== document.body && path.length < 5; c = c.parentElement) {
    path.unshift(c.tagName.toLowerCase() + (c.id ? "#" + c.id : ""));
  }
  return {
    selector: cssSelector(el),
    path: path.join(" > "),
    tag: el.tagName.toLowerCase(),
    text: ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200),
    html: clone.outerHTML.slice(0, 700),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    attrs,
    styles: {
      color: cs.color,
      background: cs.backgroundColor,
      fontSize: cs.fontSize,
      display: cs.display,
      position: cs.position,
      visibility: cs.visibility,
      opacity: cs.opacity,
    },
  };
}

/** 进入选择模式：悬停高亮，点击选中，Esc 取消 */
export function pickElement(shadow: ShadowRoot, labels: { hint: string }): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "pick-box";
    const tip = document.createElement("div");
    tip.className = "pick-tip";
    tip.textContent = labels.hint;
    shadow.append(box, tip);
    let current: HTMLElement | null = null;

    const inHost = (e: Event) => e.composedPath().some((n) => (n as Element).id === HOST_ID);
    const target = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el && el.id !== HOST_ID ? el : null;
    };

    const move = (e: MouseEvent) => {
      if (inHost(e)) return;
      const el = target(e.clientX, e.clientY);
      if (!el || el === current) return;
      current = el;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      box.dataset.label = cssSelector(el).slice(-60);
    };
    const swallow = (e: Event) => {
      if (inHost(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const click = (e: MouseEvent) => {
      if (inHost(e)) return;
      e.preventDefault();
      e.stopPropagation();
      done(current ?? target(e.clientX, e.clientY));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    };
    const done = (el: HTMLElement | null) => {
      document.removeEventListener("mousemove", move, true);
      for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.removeEventListener(t, swallow, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      box.remove();
      tip.remove();
      resolve(el);
    };
    document.addEventListener("mousemove", move, true);
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.addEventListener(t, swallow, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
  });
}
