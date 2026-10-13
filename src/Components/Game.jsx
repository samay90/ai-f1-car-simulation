import { useEffect, useRef, useState } from "react";

const STEP_MS = 60;        // physics step; lower = faster game
const DEFAULT_VIEW = 500;   // cells visible across the screen width
const MINIMAP_W = 120;     // minimap width in px

const fmt = (ms) => (ms == null ? "—" : (ms / 1000).toFixed(2) + "s");

export default function PlayGame({ game, agent }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const hudRef = useRef(null);
  const keys = useRef(new Set());
  const viewCols = useRef(DEFAULT_VIEW);   // zoom level (cells across)
  const sim = useRef({
    prev: null, curr: null, status: "playing",
    ai: false, aiSteps: 0, trail: [],
    steps: 0, started: false, recorded: false,
  });

  const [results, setResults] = useState({ you: {}, ai: {} });

  const reset = (ai = false) => {
    const start = game.getStartState();
    Object.assign(sim.current, {
      prev: start, curr: start, status: "playing",
      ai, aiSteps: 0, trail: [],
      steps: 0, started: ai, recorded: false,
    });
  };

  useEffect(() => {
    const cols = game.track[0].length;
    const rows = game.track.length;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // track image: one pixel per cell, built once
    const bg = document.createElement("canvas");
    bg.width = cols; bg.height = rows;
    const bctx = bg.getContext("2d");
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        bctx.fillStyle = game.isWallAt(x, y) ? "#222" : "#ddd";
        bctx.fillRect(x, y, 1, 1);
      }
    }

    // canvas fills the wrapper; zoom is computed per frame
    const layout = { w: 0, h: 0, dpr: 1 };
    const applyLayout = () => {
      const dpr = window.devicePixelRatio || 1;
      layout.w = wrap.clientWidth;
      layout.h = wrap.clientHeight;
      layout.dpr = dpr;
      canvas.width = Math.round(layout.w * dpr);
      canvas.height = Math.round(layout.h * dpr);
    };
    applyLayout();
    const ro = new ResizeObserver(applyLayout);
    ro.observe(wrap);

    reset(false);

    const humanAction = () => {
      const k = keys.current;
      return {
        steering: k.has("ArrowLeft") ? -game.maxSteeringDeg
                : k.has("ArrowRight") ? game.maxSteeringDeg : 0,
        acceleration: k.has("ArrowUp") ? game.maxAcceleration
                    : k.has("ArrowDown") ? -game.maxBraking : 0,
      };
    };

    const record = (s) => {
      if (s.recorded) return;
      s.recorded = true;
      const mode = s.ai ? "ai" : "you";
      const entry = { status: s.status, ms: s.steps * STEP_MS, steps: s.steps };
      setResults((prev) => {
        const old = prev[mode];
        const better = s.status === "won" && (!old.best || entry.ms < old.best.ms);
        return { ...prev, [mode]: { last: entry, best: better ? entry : old.best } };
      });
    };

    const step = () => {
      const s = sim.current;
      const action = s.ai && agent ? agent.getBestAction(s.curr) : humanAction();
      const next = game.getNextState(s.curr, action);
      s.prev = s.curr;
      s.curr = next;
      s.steps++;
      s.trail.push({ x: next.x, y: next.y });
      if (s.trail.length > 40) s.trail.shift();

      if (game.isGoalState(next)) s.status = "won";
      else if (game.isWall(next)) s.status = "crashed";
      else if (s.ai && ++s.aiSteps > (agent?.maxStepsPerEpisode ?? 400)) s.status = "timeout";

      if (s.status !== "playing") record(s);
    };

    // camera position that keeps the car centered but never shows past the track edge
    const clampCam = (center, view, total) =>
      view >= total ? (total - view) / 2 : Math.max(0, Math.min(total - view, center - view / 2));

    let raf, last = performance.now(), acc = 0;

    const frame = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      const s = sim.current;
      const { w, h, dpr } = layout;

      if (!s.started && !s.ai && keys.current.size > 0) s.started = true;

      if (s.status === "playing" && s.started) {
        acc += dt;
        while (acc >= STEP_MS && s.status === "playing") { step(); acc -= STEP_MS; }
      } else if (s.status !== "playing") acc = 0;

      // interpolated car position (in cell units) and heading
      const t = s.status === "playing" && s.started ? acc / STEP_MS : 1;
      const cx = s.prev.x + (s.curr.x - s.prev.x) * t + 0.5;
      const cy = s.prev.y + (s.curr.y - s.prev.y) * t + 0.5;
      const ang = s.prev.direction + (s.curr.direction - s.prev.direction) * t;

      // camera: scale from zoom, visible rows from the canvas aspect ratio
      const vCols = viewCols.current;
      const scale = w / vCols;
      const vRows = h / scale;
      const camX = clampCam(cx, vCols, cols);
      const camY = clampCam(cy, vRows, rows);
      const toX = (wx) => (wx - camX) * scale;
      const toY = (wy) => (wy - camY) * scale;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);                     // area outside the track
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bg, toX(0), toY(0), cols * scale, rows * scale);

      // goal
      const g = game.getGoalState();
      ctx.fillStyle = "rgba(0,180,0,0.45)";
      ctx.beginPath();
      ctx.arc(toX(g.x + 0.5), toY(g.y + 0.5), game.goalRadius * scale, 0, Math.PI * 2);
      ctx.fill();

      // trail
      const dot = Math.max(1.5, scale * 0.35);
      s.trail.forEach((p, i) => {
        ctx.fillStyle = `rgba(30,144,255,${(i / s.trail.length) * 0.4})`;
        ctx.beginPath();
        ctx.arc(toX(p.x + 0.5), toY(p.y + 0.5), dot, 0, Math.PI * 2);
        ctx.fill();
      });

      // car
      const size = Math.max(8, scale * 1.2);
      ctx.save();
      ctx.translate(toX(cx), toY(cy));
      ctx.rotate(ang);
      ctx.fillStyle = s.status === "crashed" || s.status === "timeout" ? "red"
                    : s.status === "won" ? "limegreen" : "dodgerblue";
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.65, -size * 0.55);
      ctx.lineTo(-size * 0.65, size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // minimap (top-right)
      const mw = MINIMAP_W, mh = (MINIMAP_W * rows) / cols, pad = 8;
      const mx = w - mw - pad, my = pad, ms = mw / cols;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(bg, mx, my, mw, mh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
      ctx.strokeRect(mx - 0.5, my - 0.5, mw + 1, mh + 1);
      ctx.strokeStyle = "rgba(255,200,0,0.9)";       // current view window
      ctx.strokeRect(mx + camX * ms, my + camY * ms,
                     Math.min(vCols, cols) * ms, Math.min(vRows, rows) * ms);
      ctx.fillStyle = "limegreen";
      ctx.fillRect(mx + (g.x + 0.5) * ms - 2, my + (g.y + 0.5) * ms - 2, 4, 4);
      ctx.fillStyle = "dodgerblue";
      ctx.beginPath();
      ctx.arc(mx + cx * ms, my + cy * ms, 3, 0, Math.PI * 2);
      ctx.fill();

      if (hudRef.current) {
        const ms2 = s.steps * STEP_MS + (s.status === "playing" && s.started ? acc : 0);
        const hint = !s.started && !s.ai ? " · press a key to start" : "";
        hudRef.current.textContent =
          `${s.ai ? "AI" : "You"} · ${s.status} · ${fmt(ms2)} · ${s.steps} steps · speed ${s.curr.speed.toFixed(1)}${hint}`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const zoom = (factor) => {
      viewCols.current = Math.max(10, Math.min(cols, viewCols.current * factor));
    };
    const down = (e) => {
      if (e.key.startsWith("Arrow")) e.preventDefault();
      if (e.key === "r" || e.key === "R") return reset(false);
      if (e.key === "+" || e.key === "=") return zoom(1 / 1.2);  // zoom in
      if (e.key === "-" || e.key === "_") return zoom(1.2);      // zoom out
      keys.current.add(e.key);
    };
    const up = (e) => keys.current.delete(e.key);
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [game, agent]);

  const you = results.you.best, ai = results.ai.best;
  let verdict = "";
  if (you && ai) {
    const diff = Math.abs(you.ms - ai.ms);
    verdict = diff === 0 ? "Tie!" :
      you.ms < ai.ms ? `You beat the AI by ${fmt(diff)}` : `AI beats you by ${fmt(diff)}`;
  }

  const row = (label, r) => (
    <tr>
      <td style={{ padding: "2px 12px 2px 0" }}>{label}</td>
      <td style={{ padding: "2px 12px 2px 0" }}>
        {r.last ? `${r.last.status} · ${fmt(r.last.ms)} (${r.last.steps} steps)` : "—"}
      </td>
      <td>{r.best ? `${fmt(r.best.ms)} (${r.best.steps} steps)` : "—"}</td>
    </tr>
  );

  return (
    <div>
      <div
        ref={wrapRef}
        style={{ width: "100%", height: "calc(100dvh - 230px)", background: "#000" }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>

      <p ref={hudRef} style={{ margin: "4px 0", fontWeight: 600 }} />
      <button onClick={() => reset(false)}>Restart</button>
      {agent && <button onClick={() => reset(true)}>Watch AI</button>}
      <button onClick={() => setResults({ you: {}, ai: {} })}>Clear results</button>
      <span style={{ marginLeft: 12 }}>
        ←/→ steer · ↑ accelerate · ↓ brake · +/− zoom · R restart
      </span>

      <table style={{ marginTop: 8, fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th></th><th>Last run</th><th>Best (wins only)</th>
          </tr>
        </thead>
        <tbody>
          {row("You", results.you)}
          {row("AI", results.ai)}
        </tbody>
      </table>
      {verdict && <p style={{ margin: "4px 0", fontWeight: 600 }}>{verdict}</p>}
    </div>
  );
}