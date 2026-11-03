import type { ConsoleEntry, NetEntry } from "./types";

const consoleBuf: ConsoleEntry[] = [];
const netBuf: NetEntry[] = [];
let installed = false;

export const nativeFetch: typeof fetch = window.fetch.bind(window);

const SENSITIVE = /token|key|secret|auth|password|passwd|sig|code|session|jwt/i;

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, location.href);
    u.searchParams.forEach((_, k) => {
      if (SENSITIVE.test(k)) u.searchParams.set(k, "[redacted]");
    });
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return raw.slice(0, 300);
  }
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === "function" ? "[Function]" : val)) ?? String(v);
  } catch {
    return String(v);
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function pushConsole(buf: ConsoleEntry[], max: number, e: ConsoleEntry) {
  buf.push(e);
  if (buf.length > max) buf.shift();
}

export function installCollectors(opts: { maxConsole: number; maxNetwork: number; ignoreUrl: (u: string) => boolean; captureBody: boolean }) {
  if (installed) return;
  installed = true;
  let busy = false; // 防止 hook 内部再触发 console 导致递归

  (["log", "info", "warn", "error", "debug"] as const).forEach((level) => {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (!busy) {
        busy = true;
        try {
          const stackErr = args.find((a) => a instanceof Error) as Error | undefined;
          pushConsole(consoleBuf, opts.maxConsole, {
            t: Date.now(),
            level,
            msg: clip(args.map(fmt).join(" "), 2000),
            stack: stackErr?.stack ? clip(stackErr.stack, 1500) : undefined,
          });
        } finally {
          busy = false;
        }
      }
      orig(...args);
    };
  });

  window.addEventListener(
    "error",
    (ev) => {
      const target = ev.target as (HTMLElement & { src?: string; href?: string }) | Window | null;
      if (target && target !== window && "tagName" in target) {
        const url = target.src || target.href || "";
        pushConsole(consoleBuf, opts.maxConsole, { t: Date.now(), level: "error", msg: `资源加载失败 <${target.tagName.toLowerCase()}> ${redactUrl(url)}` });
        return;
      }
      pushConsole(consoleBuf, opts.maxConsole, {
        t: Date.now(),
        level: "error",
        msg: clip(`${ev.message} (${ev.filename}:${ev.lineno}:${ev.colno})`, 2000),
        stack: ev.error?.stack ? clip(String(ev.error.stack), 1500) : undefined,
      });
    },
    true,
  );

  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    pushConsole(consoleBuf, opts.maxConsole, {
      t: Date.now(),
      level: "error",
      msg: clip(`未处理的 Promise 拒绝: ${fmt(r)}`, 2000),
      stack: r?.stack ? clip(String(r.stack), 1500) : undefined,
    });
  });

  const addNet = (e: NetEntry) => {
    netBuf.push(e);
    if (netBuf.length > opts.maxNetwork) netBuf.shift();
  };

  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (opts.ignoreUrl(url)) return nativeFetch(input, init);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const t = Date.now();
    const t0 = performance.now();
    return nativeFetch(input, init).then(
      (res) => {
        const entry: NetEntry = { t, kind: "fetch", method, url: redactUrl(url), status: res.status, ok: res.ok, ms: Math.round(performance.now() - t0) };
        addNet(entry);
        if (!res.ok && opts.captureBody) {
          res
            .clone()
            .text()
            .then((b) => (entry.body = clip(b, 800)))
            .catch(() => undefined);
        }
        return res;
      },
      (err) => {
        addNet({ t, kind: "fetch", method, url: redactUrl(url), status: 0, ok: false, ms: Math.round(performance.now() - t0), error: clip(fmt(err), 300) });
        throw err;
      },
    );
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  type Meta = { method: string; url: string };
  const metaMap = new WeakMap<XMLHttpRequest, Meta>();
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    metaMap.set(this, { method: method.toUpperCase(), url: String(url) });
    return (xhrOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = metaMap.get(this);
    if (meta && !opts.ignoreUrl(meta.url)) {
      const t = Date.now();
      const t0 = performance.now();
      this.addEventListener("loadend", () => {
        const ok = this.status >= 200 && this.status < 400;
        addNet({
          t,
          kind: "xhr",
          method: meta.method,
          url: redactUrl(meta.url),
          status: this.status,
          ok,
          ms: Math.round(performance.now() - t0),
          error: this.status === 0 ? "请求失败或被中止" : undefined,
        });
      });
    }
    return xhrSend.call(this, body);
  };
}

export const getConsole = () => consoleBuf.slice();
export const getNetwork = () => netBuf.slice();

export function getEnvironment() {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  return {
    url: redactUrl(location.href),
    title: document.title,
    referrer: document.referrer ? redactUrl(document.referrer) : "",
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    screen: { w: screen.width, h: screen.height },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    online: navigator.onLine,
    connection: nav.connection?.effectiveType ?? "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    time: new Date().toISOString(),
  };
}
