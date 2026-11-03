type Tool = "pen" | "rect" | "arrow";
type Op = { tool: Tool; color: string; pts: { x: number; y: number }[] };

export interface AnnotateLabels {
  pen: string;
  rect: string;
  arrow: string;
  undo: string;
  clear: string;
  done: string;
  cancel: string;
  title: string;
}

const COLORS = ["#e8501c", "#1d4ed8", "#16a34a", "#111111"];

function drawOp(ctx: CanvasRenderingContext2D, op: Op, lw: number) {
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const a = op.pts[0];
  const b = op.pts[op.pts.length - 1];
  ctx.beginPath();
  if (op.tool === "pen") {
    ctx.moveTo(a.x, a.y);
    op.pts.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  } else if (op.tool === "rect") {
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  } else {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = lw * 4.5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }
}

/** 在截图上画笔/框/箭头；返回标注后的图，取消返回 null */
export function annotate(shadow: ShadowRoot, src: Blob, L: AnnotateLabels): Promise<Blob | null> {
  return new Promise(async (resolve) => {
    const bmp = await createImageBitmap(src);
    const wrap = document.createElement("div");
    wrap.className = "ann";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", L.title);
    wrap.innerHTML = `
      <div class="ann-bar">
        <div class="ann-tools">
          <button data-tool="pen" class="on" type="button">${L.pen}</button>
          <button data-tool="rect" type="button">${L.rect}</button>
          <button data-tool="arrow" type="button">${L.arrow}</button>
          <span class="ann-colors"></span>
          <button data-act="undo" type="button">${L.undo}</button>
          <button data-act="clear" type="button">${L.clear}</button>
        </div>
        <div class="ann-actions">
          <button data-act="cancel" type="button">${L.cancel}</button>
          <button data-act="done" class="primary" type="button">${L.done}</button>
        </div>
      </div>
      <div class="ann-stage"><canvas></canvas></div>`;
    shadow.append(wrap);

    const canvas = wrap.querySelector("canvas")!;
    const stage = wrap.querySelector(".ann-stage") as HTMLElement;
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    const ops: Op[] = [];
    let tool: Tool = "pen";
    let color = COLORS[0];
    let cur: Op | null = null;
    const lw = Math.max(3, Math.round(bmp.width / 300));

    // 画布按舞台大小等比缩放显示
    const fit = () => {
      const s = Math.min((stage.clientWidth - 32) / bmp.width, (stage.clientHeight - 32) / bmp.height, 1);
      canvas.style.width = Math.round(bmp.width * s) + "px";
      canvas.style.height = Math.round(bmp.height * s) + "px";
    };
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0);
      ops.forEach((o) => drawOp(ctx, o, lw));
      if (cur) drawOp(ctx, cur, lw);
    };
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
    };

    const colorsEl = wrap.querySelector(".ann-colors")!;
    COLORS.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sw" + (i === 0 ? " on" : "");
      b.style.background = c;
      b.setAttribute("aria-label", c);
      b.onclick = () => {
        color = c;
        colorsEl.querySelectorAll(".sw").forEach((x) => x.classList.toggle("on", x === b));
      };
      colorsEl.append(b);
    });

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      cur = { tool, color, pts: [pos(e)] };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!cur) return;
      if (tool === "pen") cur.pts.push(pos(e));
      else cur.pts = [cur.pts[0], pos(e)];
      redraw();
    });
    const end = () => {
      if (cur && cur.pts.length > 1) ops.push(cur);
      cur = null;
      redraw();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    const finish = (ok: boolean) => {
      window.removeEventListener("resize", fit);
      document.removeEventListener("keydown", onKey, true);
      if (!ok) {
        wrap.remove();
        bmp.close();
        return resolve(null);
      }
      redraw();
      canvas.toBlob(
        (b) => {
          wrap.remove();
          bmp.close();
          resolve(b);
        },
        "image/jpeg",
        0.9,
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        ops.pop();
        redraw();
      }
    };
    document.addEventListener("keydown", onKey, true);

    wrap.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
      if (!t) return;
      if (t.dataset.tool) {
        tool = t.dataset.tool as Tool;
        wrap.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("on", x === t));
      } else if (t.dataset.act === "undo") {
        ops.pop();
        redraw();
      } else if (t.dataset.act === "clear") {
        ops.length = 0;
        redraw();
      } else if (t.dataset.act === "done") finish(true);
      else if (t.dataset.act === "cancel") finish(false);
    });

    window.addEventListener("resize", fit);
    fit();
    redraw();
  });
}
