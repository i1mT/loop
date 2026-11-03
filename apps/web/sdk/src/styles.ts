export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
:host, .root {
  --bg: #fbfaf6; --fg: #1b1a17; --muted: #6f6b62; --line: #ddd8cb; --field: #fff;
  --accent: #e8501c; --accent-fg: #fff; --danger: #b3261e; --ok: #276b44; --shadow: 0 12px 40px rgba(27,26,23,.18);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--fg);
}
.root[data-theme="dark"] {
  --bg: #1d1c19; --fg: #f1eee6; --muted: #a39e92; --line: #3a3832; --field: #151412; --shadow: 0 12px 40px rgba(0,0,0,.5);
}
button { font: inherit; color: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.fab {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--fg);
  box-shadow: var(--shadow); font-weight: 500;
}
.fab:hover { border-color: var(--accent); }
.fab .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }

.panel {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483001;
  width: 380px; max-width: calc(100vw - 24px); max-height: calc(100vh - 40px); overflow: auto;
  background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow);
}
.panel[hidden], .fab[hidden] { display: none; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 6px; }
.head h2 { margin: 0; font-size: 15px; font-weight: 600; }
.x { border: 0; background: none; font-size: 20px; line-height: 1; color: var(--muted); padding: 4px 8px; border-radius: 6px; }
.x:hover { color: var(--fg); }
.body { padding: 8px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
textarea, input[type=text], input[type=email] {
  width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--fg);
  padding: 9px 11px; font: inherit; resize: vertical;
}
textarea { min-height: 96px; }
textarea:focus, input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); border-color: var(--accent); }
.tools { display: flex; gap: 8px; flex-wrap: wrap; }
.tool { height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); font-size: 13px; }
.tool:hover { border-color: var(--accent); }
.tool[disabled] { opacity: .55; cursor: progress; }
.hint { font-size: 12px; color: var(--muted); margin-top: -4px; }
.chip { display: flex; align-items: flex-start; gap: 8px; border: 1px dashed var(--accent); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.chip code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.chip .grow { flex: 1; min-width: 0; }
.chip .t { color: var(--muted); display: block; }
.link { border: 0; background: none; color: var(--muted); text-decoration: underline; padding: 0; font-size: 12px; }
.thumbs { display: flex; gap: 8px; flex-wrap: wrap; }
.thumb { position: relative; width: 72px; height: 54px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--field); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: pointer; }
.thumb .rm { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: rgba(0,0,0,.65); color: #fff; font-size: 12px; line-height: 18px; padding: 0; }
.diag { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.diag summary { cursor: pointer; color: var(--muted); }
.diag label { display: flex; gap: 8px; align-items: flex-start; margin-top: 8px; }
.diag input { margin-top: 3px; accent-color: var(--accent); }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.msg { font-size: 12px; color: var(--muted); min-height: 18px; flex: 1; }
.msg.err { color: var(--danger); }
.send { height: 34px; padding: 0 18px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 600; }
.send[disabled] { opacity: .6; cursor: progress; }
.mine-btn { border: 0; background: none; color: var(--muted); text-decoration: underline; font-size: 12px; padding: 4px 6px; margin-left: auto; }
.mine-btn:hover { color: var(--fg); }
.mine-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.mine-item { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.mine-item .t { font-weight: 500; word-break: break-word; }
.mine-item .s { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; font-size: 12px; color: var(--muted); }
.mine-item .chip-s { font-weight: 600; color: var(--fg); }
.mine-item .chip-s.ok { color: var(--ok); }
.mine-item .m { margin-top: 6px; font-size: 12px; color: var(--muted); }
.ticket { font: 12px ui-monospace, Menlo, monospace; color: var(--muted); word-break: break-all; }
.done { text-align: center; padding: 28px 8px 12px; display: flex; flex-direction: column; gap: 14px; align-items: center; }
.done .tick { width: 40px; height: 40px; border-radius: 50%; background: var(--ok); color: #fff; display: grid; place-items: center; font-size: 20px; }

.pick-box { position: fixed; z-index: 2147483002; pointer-events: none; display: none; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.pick-box::after { content: attr(data-label); position: absolute; left: -2px; top: -24px; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--accent); color: #fff; font: 11px/20px ui-monospace, Menlo, monospace; padding: 0 6px; border-radius: 3px; }
.pick-tip { position: fixed; z-index: 2147483003; left: 50%; top: 14px; transform: translateX(-50%); background: #1b1a17; color: #fff; font-size: 13px; padding: 7px 14px; border-radius: 999px; pointer-events: none; }

.ann { position: fixed; inset: 0; z-index: 2147483004; background: rgba(15,14,12,.92); display: flex; flex-direction: column; color: #fff; }
.ann-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; flex-wrap: wrap; }
.ann-tools, .ann-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ann button { height: 32px; padding: 0 12px; border: 1px solid #55524a; border-radius: 8px; background: #2a2925; color: #fff; }
.ann button.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 25%, #2a2925); }
.ann button.primary { background: var(--accent); border-color: var(--accent); font-weight: 600; }
.ann .sw { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid #8a867c; }
.ann .sw.on { border-color: #fff; box-shadow: 0 0 0 2px var(--accent); }
.ann-colors { display: inline-flex; gap: 6px; margin: 0 6px; }
.ann-stage { flex: 1; min-height: 0; display: grid; place-items: center; overflow: auto; }
.ann canvas { touch-action: none; cursor: crosshair; background: #fff; box-shadow: 0 6px 30px rgba(0,0,0,.5); }
@media (prefers-reduced-motion: no-preference) { .panel { animation: pop .14s ease-out; } @keyframes pop { from { opacity: 0; transform: translateY(6px); } } }
@media (max-width: 480px) { .panel { right: 8px; bottom: 8px; left: 8px; width: auto; } .fab { right: 12px; bottom: 12px; } }
`;
