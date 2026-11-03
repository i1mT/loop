import { annotate } from "./annotate";
import { HOST_ID, canvasToBlob, describeElement, normalizeImage, pickElement, screenshotElement, screenshotViewport } from "./capture";
import { getConsole, getEnvironment, getNetwork, installCollectors, nativeFetch } from "./collectors";
import { detectLocale, dicts, type Dict } from "./i18n";
import { CSS } from "./styles";
import type { Attachment, ElementInfo, InitOptions, UserInfo } from "./types";

const VERSION = "0.2.0";
const MAX_FILES = 6;

// 脚本同步执行时才能拿到 currentScript：用它推断网关地址和自动初始化参数
const script = document.currentScript as HTMLScriptElement | null;
const scriptOrigin = script?.src ? new URL(script.src).origin : "";

function toBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

interface MineItem {
  id: string;
  t: string;
  title: string;
  at: number;
}

// 提交过的反馈只记在本机：编号 + 查询令牌，用来查看进度
const storeKey = (key: string) => `loop-feedback:${key}`;
function loadMine(key: string): MineItem[] {
  try {
    return JSON.parse(localStorage.getItem(storeKey(key)) || "[]");
  } catch {
    return [];
  }
}
function saveMine(key: string, list: MineItem[]) {
  try {
    localStorage.setItem(storeKey(key), JSON.stringify(list.slice(0, 20)));
  } catch {
    /* 隐私模式等情况下不可用，忽略 */
  }
}

let uid = 0;
const nextId = () => `a${++uid}`;

class Widget {
  private opts!: InitOptions;
  private t!: Dict;
  private host!: HTMLElement;
  private shadow!: ShadowRoot;
  private fab!: HTMLButtonElement;
  private panel!: HTMLElement;
  private attachments: Attachment[] = [];
  private element: { info: ElementInfo; el: HTMLElement } | null = null;
  private user: UserInfo | undefined;
  private identity: string | undefined;
  private busy = false;
  private diagTimer: ReturnType<typeof setInterval> | undefined;

  init(opts: InitOptions) {
    if (this.host) return;
    if (!opts.key) {
      console.warn("[LoopFeedback] 缺少 key");
      return;
    }
    this.opts = { maxConsole: 100, maxNetwork: 60, ...opts };
    this.user = opts.user;
    this.identity = opts.identity;
    this.t = dicts[opts.locale ?? detectLocale()];
    const endpoint = this.endpoint();
    installCollectors({
      maxConsole: this.opts.maxConsole!,
      maxNetwork: this.opts.maxNetwork!,
      ignoreUrl: (u) => u.startsWith(endpoint + "/api/ingest/"),
      captureBody: !!opts.captureResponseBody,
    });
    const mount = () => this.mount();
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  setUser(u: UserInfo | undefined) {
    this.user = u;
  }

  setIdentity(token: string | undefined) {
    this.identity = token;
  }

  open() {
    if (!this.host) return;
    this.fab.hidden = true;
    this.panel.hidden = false;
    (this.panel.querySelector("textarea") as HTMLTextAreaElement).focus();
    this.refreshDiag();
    this.refreshMineBtn();
    // 面板打开期间持续刷新诊断计数（用户可能边操作边复现问题）
    clearInterval(this.diagTimer);
    this.diagTimer = setInterval(() => this.refreshDiag(false), 1000);
  }

  close() {
    if (!this.host) return;
    this.panel.hidden = true;
    this.fab.hidden = !!this.opts.hideButton;
    clearInterval(this.diagTimer);
  }

  destroy() {
    clearInterval(this.diagTimer);
    this.host?.remove();
    this.attachments.forEach((a) => URL.revokeObjectURL(a.url));
  }

  private endpoint() {
    return (this.opts.endpoint || scriptOrigin || location.origin).replace(/\/$/, "");
  }

  private theme() {
    const th = this.opts.theme ?? "auto";
    return th === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : th;
  }

  private mount() {
    const t = this.t;
    this.host = document.createElement("div");
    this.host.id = HOST_ID;
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `
      <style>${CSS}</style>
      <div class="root" data-theme="${this.theme()}">
        <button class="fab" type="button"><span class="dot"></span>${t.fab}</button>
        <section class="panel" role="dialog" aria-label="${t.title}" hidden>
          <div class="head"><h2>${t.title}</h2><button class="mine-btn" type="button" data-act="mine" hidden>${t.mine}</button><button class="x" type="button" aria-label="${t.close}">×</button></div>
          <div class="body" data-mine hidden></div>
          <div class="body" data-form>
            <textarea name="description" placeholder="${t.placeholder}" maxlength="5000"></textarea>
            <input type="text" name="contact" placeholder="${t.contact}" autocomplete="email" />
            <div class="tools">
              <button class="tool" type="button" data-act="shot">${t.shot}</button>
              <button class="tool" type="button" data-act="pick">${t.pick}</button>
              <button class="tool" type="button" data-act="upload">${t.upload}</button>
              <input type="file" accept="image/*" multiple hidden />
            </div>
            <div class="hint">${t.pasteHint}</div>
            <div class="chip" data-chip hidden></div>
            <div class="thumbs" data-thumbs></div>
            <details class="diag">
              <summary>${t.diag}</summary>
              <label><input type="checkbox" name="c_console" checked /><span data-lbl="console"></span></label>
              <label><input type="checkbox" name="c_network" checked /><span data-lbl="network"></span></label>
              <label><input type="checkbox" name="c_env" checked /><span>${t.diagEnv}</span></label>
            </details>
            <div class="foot"><div class="msg" role="status" aria-live="polite"></div><button class="send" type="button">${t.send}</button></div>
          </div>
        </section>
      </div>`;
    document.body.append(this.host);
    const $ = <T extends HTMLElement>(s: string) => this.shadow.querySelector(s) as T;
    this.fab = $(".fab");
    this.panel = $(".panel");
    this.fab.hidden = !!this.opts.hideButton;

    this.fab.onclick = () => this.open();
    $(".x").onclick = () => this.close();
    this.panel.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") this.close();
    });
    const file = $<HTMLInputElement>("input[type=file]");
    this.panel.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "shot") void this.doShot();
      else if (act === "pick") void this.doPick();
      else if (act === "upload") file.click();
      else if (act === "mine") void this.showMine();
      else if (act === "back") this.showForm();
    });
    file.onchange = () => {
      void this.addFiles([...(file.files ?? [])], "upload");
      file.value = "";
    };
    $(".send").onclick = () => void this.send();

    // 粘贴截图：面板打开时监听整个页面的粘贴
    document.addEventListener("paste", (e) => {
      if (this.panel.hidden) return;
      const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()!).filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      void this.addFiles(files, "paste");
    });
    this.panel.addEventListener("dragover", (e) => e.preventDefault());
    this.panel.addEventListener("drop", (e) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void this.addFiles(files, "upload");
    });
    this.refreshDiag();
  }

  private msg(text: string, err = false) {
    const m = this.shadow.querySelector(".msg") as HTMLElement;
    m.textContent = text;
    m.classList.toggle("err", err);
  }

  private refreshDiag(autoOpen = true) {
    const t = this.t;
    const lblC = this.shadow.querySelector('[data-lbl="console"]') as HTMLElement | null;
    const lblN = this.shadow.querySelector('[data-lbl="network"]') as HTMLElement | null;
    if (!lblC || !lblN) return; // 已切换到成功页
    const con = getConsole();
    const net = getNetwork();
    const ce = con.filter((c) => c.level === "error").length;
    const nf = net.filter((n) => !n.ok).length;
    lblC.textContent = `${t.diagConsole}（${con.length}${t.items}${ce ? `，${ce} ${t.errors}` : ""}）`;
    lblN.textContent = `${t.diagNetwork}（${net.length}${t.items}${nf ? `，${nf} ${t.failed}` : ""}）`;
    // 有错误时默认展开，提示用户这些会被一起发送
    const d = this.shadow.querySelector(".diag") as HTMLDetailsElement | null;
    if (autoOpen && d) d.open = ce + nf > 0;
  }

  private setBusy(on: boolean) {
    this.busy = on;
    this.shadow.querySelectorAll<HTMLButtonElement>(".tool, .send").forEach((b) => (b.disabled = on));
  }

  private async doShot() {
    if (this.busy) return;
    if (this.attachments.length >= MAX_FILES) return this.msg(this.t.tooMany, true);
    this.setBusy(true);
    this.msg(this.t.capturing);
    try {
      const blob = await canvasToBlob(await screenshotViewport());
      this.msg("");
      this.setBusy(false);
      await this.addBlob(blob, "screenshot", "screenshot.jpg", true);
    } catch (e) {
      console.warn("[LoopFeedback] 截图失败", e);
      this.msg(this.t.captureFail, true);
      this.setBusy(false);
    }
  }

  private async doPick() {
    if (this.busy) return;
    this.panel.hidden = true;
    const el = await pickElement(this.shadow, { hint: this.t.pickHint });
    this.panel.hidden = false;
    if (!el) return;
    this.element = { info: describeElement(el), el };
    this.renderChip();
    if (this.attachments.length < MAX_FILES) {
      try {
        const blob = await canvasToBlob(await screenshotElement(el));
        await this.addBlob(blob, "element", "element.jpg", false);
      } catch {
        /* 元素截图失败不影响其余信息 */
      }
    }
  }

  private renderChip() {
    const chip = this.shadow.querySelector("[data-chip]") as HTMLElement;
    if (!this.element) {
      chip.hidden = true;
      return;
    }
    const i = this.element.info;
    chip.hidden = false;
    chip.innerHTML = `<div class="grow"><span class="t">${this.t.picked}</span><code></code></div><button class="link" type="button">${this.t.remove}</button>`;
    (chip.querySelector("code") as HTMLElement).textContent = i.selector;
    (chip.querySelector("button") as HTMLElement).onclick = () => {
      this.element = null;
      this.renderChip();
    };
  }

  private async addFiles(files: File[], kind: Attachment["kind"]) {
    for (const f of files) {
      if (this.attachments.length >= MAX_FILES) return this.msg(this.t.tooMany, true);
      await this.addBlob(f, kind, f.name || "image", false);
    }
  }

  private async addBlob(raw: Blob, kind: Attachment["kind"], name: string, edit: boolean) {
    if (this.attachments.length >= MAX_FILES) return this.msg(this.t.tooMany, true);
    let blob = await normalizeImage(raw).catch(() => raw);
    if (edit) {
      const edited = await annotate(this.shadow, blob, this.t.ann);
      if (edited) blob = edited;
    }
    this.attachments.push({ id: nextId(), name, kind, blob, url: URL.createObjectURL(blob) });
    this.renderThumbs();
    this.msg("");
  }

  private renderThumbs() {
    const box = this.shadow.querySelector("[data-thumbs]") as HTMLElement;
    box.textContent = "";
    for (const a of this.attachments) {
      const d = document.createElement("div");
      d.className = "thumb";
      const img = document.createElement("img");
      img.src = a.url;
      img.alt = a.name;
      img.title = this.t.edit;
      img.onclick = async () => {
        const edited = await annotate(this.shadow, a.blob, this.t.ann);
        if (!edited) return;
        URL.revokeObjectURL(a.url);
        a.blob = edited;
        a.url = URL.createObjectURL(edited);
        this.renderThumbs();
      };
      const rm = document.createElement("button");
      rm.className = "rm";
      rm.type = "button";
      rm.textContent = "×";
      rm.setAttribute("aria-label", this.t.remove);
      rm.onclick = () => {
        URL.revokeObjectURL(a.url);
        this.attachments = this.attachments.filter((x) => x.id !== a.id);
        this.renderThumbs();
      };
      d.append(img, rm);
      box.append(d);
    }
  }

  private async send() {
    if (this.busy) return;
    const q = <T extends HTMLElement>(s: string) => this.shadow.querySelector(s) as T;
    const description = q<HTMLTextAreaElement>("textarea").value.trim();
    if (!description && this.attachments.length === 0 && !this.element) return this.msg(this.t.needContent, true);

    const contact = q<HTMLInputElement>("input[name=contact]").value.trim();
    const withConsole = q<HTMLInputElement>("input[name=c_console]").checked;
    const withNetwork = q<HTMLInputElement>("input[name=c_network]").checked;
    const withEnv = q<HTMLInputElement>("input[name=c_env]").checked;

    const report = {
      sdk: VERSION,
      description,
      contact,
      user: this.user,
      meta: this.opts.meta,
      env: withEnv ? getEnvironment() : { url: location.href.split(/[?#]/)[0] },
      element: this.element?.info ?? null,
      console: withConsole ? getConsole() : [],
      network: withNetwork ? getNetwork() : [],
      files: this.attachments.map((a) => ({ name: a.name, kind: a.kind })),
    };
    // 用 JSON 而非 multipart：部分框架会把跨域的表单类 POST 当作 CSRF 拦截；图片以 base64 内嵌
    const files = await Promise.all(
      this.attachments.map(async (a) => ({ name: a.name, kind: a.kind, type: a.blob.type || "image/jpeg", data: await toBase64(a.blob) })),
    );
    const payload = JSON.stringify({ report, files, identity: this.identity });

    this.setBusy(true);
    this.msg(this.t.sending);
    try {
      const res = await nativeFetch(`${this.endpoint()}/api/ingest/${encodeURIComponent(this.opts.key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const out = (await res.json().catch(() => ({}))) as { task_id?: string; token?: string };
      if (out.task_id && out.token) {
        const title = (description || report.element?.selector || "").split("\n")[0].slice(0, 60) || "(截图反馈)";
        saveMine(this.opts.key, [{ id: out.task_id, t: out.token, title, at: Date.now() }, ...loadMine(this.opts.key)]);
      }
      this.showDone(out.task_id);
    } catch (e) {
      console.warn("[LoopFeedback] 发送失败", e);
      this.msg(this.t.failedSend, true);
    } finally {
      this.setBusy(false);
    }
  }

  private refreshMineBtn() {
    const btn = this.shadow.querySelector(".mine-btn") as HTMLElement | null;
    if (btn) btn.hidden = loadMine(this.opts.key).length === 0;
  }

  private showForm() {
    (this.shadow.querySelector("[data-form]") as HTMLElement).hidden = false;
    (this.shadow.querySelector("[data-mine]") as HTMLElement).hidden = true;
  }

  // 我的反馈：向网关查询每条的最新进度（只显示对提交者有意义的阶段）
  private async showMine() {
    const t = this.t;
    const box = this.shadow.querySelector("[data-mine]") as HTMLElement;
    (this.shadow.querySelector("[data-form]") as HTMLElement).hidden = true;
    box.hidden = false;
    const list = loadMine(this.opts.key);
    box.innerHTML = `<button class="link" type="button" data-act="back">← ${t.back}</button><ul class="mine-list"></ul><div class="msg" role="status"></div>`;
    const ul = box.querySelector("ul") as HTMLElement;
    const msg = box.querySelector(".msg") as HTMLElement;
    if (!list.length) {
      msg.textContent = t.mineEmpty;
      return;
    }
    msg.textContent = t.loading;
    let status: Record<string, { label: string; stage: string; message: string | null; updated_at: number }> = {};
    try {
      const res = await nativeFetch(`${this.endpoint()}/api/feedback/status?key=${encodeURIComponent(this.opts.key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: list.map((i) => ({ id: i.id, t: i.t })) }),
        credentials: "omit",
      });
      const j = (await res.json()) as { items: (typeof status)[string] & { id: string }[] };
      for (const it of (j.items as unknown as { id: string; label: string; stage: string; message: string | null; updated_at: number }[]) ?? []) status[it.id] = it;
      msg.textContent = "";
    } catch {
      msg.textContent = t.mineFail;
      status = {};
    }
    for (const it of list) {
      const st = status[it.id];
      const li = document.createElement("li");
      li.className = "mine-item";
      const title = document.createElement("div");
      title.className = "t";
      title.textContent = it.title;
      const row = document.createElement("div");
      row.className = "s";
      const chip = document.createElement("span");
      chip.className = "chip-s" + (st?.stage === "published" ? " ok" : "");
      chip.textContent = st?.label ?? "—";
      const when = document.createElement("span");
      when.textContent = new Date(it.at).toLocaleDateString();
      row.append(chip, when);
      li.append(title, row);
      if (st?.message) {
        const m = document.createElement("div");
        m.className = "m";
        m.textContent = st.message;
        li.append(m);
      }
      ul.append(li);
    }
  }

  private showDone(taskId?: string) {
    clearInterval(this.diagTimer);
    this.refreshMineBtn();
    const body = this.shadow.querySelector("[data-form]") as HTMLElement;
    body.innerHTML = `<div class="done"><div class="tick">✓</div><div>${this.t.sent}</div>${taskId ? `<div class="ticket">${this.t.ticket}：<span data-id></span></div>` : ""}<div><button class="tool" type="button" data-more>${this.t.sentAgain}</button> <button class="tool" type="button" data-act="mine">${this.t.viewProgress}</button></div></div>`;
    if (taskId) (body.querySelector("[data-id]") as HTMLElement).textContent = taskId;
    (body.querySelector("[data-more]") as HTMLElement).onclick = () => {
      this.attachments.forEach((a) => URL.revokeObjectURL(a.url));
      this.attachments = [];
      this.element = null;
      this.destroy();
      this.host = undefined as unknown as HTMLElement;
      this.init({ ...this.opts, identity: this.identity, user: this.user });
      this.open();
    };
    this.attachments = [];
  }
}

const widget = new Widget();

export const LoopFeedback = {
  version: VERSION,
  init: (o: InitOptions) => widget.init(o),
  open: () => widget.open(),
  close: () => widget.close(),
  setUser: (u: UserInfo | undefined) => widget.setUser(u),
  setIdentity: (t: string | undefined) => widget.setIdentity(t),
  destroy: () => widget.destroy(),
};

(window as unknown as { LoopFeedback: typeof LoopFeedback }).LoopFeedback = LoopFeedback;

// <script src=".../sdk.js" data-key="..."> 自动初始化
if (script?.dataset.key) {
  LoopFeedback.init({
    key: script.dataset.key,
    endpoint: script.dataset.endpoint,
    locale: script.dataset.locale as "zh" | "en" | undefined,
    theme: script.dataset.theme as "auto" | "light" | "dark" | undefined,
    hideButton: script.dataset.hideButton === "true",
    captureResponseBody: script.dataset.captureBody === "true",
  });
}
