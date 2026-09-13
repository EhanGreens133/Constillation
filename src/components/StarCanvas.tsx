"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";

/**
 * The star view.
 *
 * Canvas, not SVG and not DOM nodes: this has to hold thousands of points at
 * 30fps on a mid-range phone. Three things make that possible:
 *   - viewport culling through a spatial grid (mandatory, not an optimisation)
 *   - level of detail: regions when far out, points then labels as you zoom in
 *   - drawing only when something changed, rather than every frame
 *
 * Positions come precomputed from the server (relaxed against the `related`
 * graph) so opening this screen never runs a layout.
 */

interface StarsPayload {
  count: number;
  clusters: { _id: string; name: string; color: string }[];
  regions: { id: string; name: string; color: string; x: number; y: number; radius: number; count: number }[];
  ids: string[];
  x: number[];
  y: number[];
  cluster: number[];
  pinned: number[];
  private: number[];
  titles: string[];
  edges: number[];
  unpositioned: number;
}

const UNFILED_COLOR = "#8a93a6";
const CELL = 220;

export function StarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<{
    n: number;
    x: Float64Array;
    y: Float64Array;
    color: string[];
    pinned: Uint8Array;
    priv: Uint8Array;
    titles: string[];
    ids: string[];
    edges: Int32Array;
    edgesOf: Int32Array[];
    grid: Map<number, number[]>;
    regions: StarsPayload["regions"];
  } | null>(null);
  const camRef = useRef({ x: 0, y: 0, scale: 1 });
  const visibleTimerRef = useRef(0);
  const dirtyRef = useRef(true);
  const selectedRef = useRef<number | null>(null);
  const draggingRef = useRef<{ index: number; moved: boolean } | null>(null);

  const [payload, setPayload] = useState<StarsPayload | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [fps, setFps] = useState(0);
  const [visible, setVisible] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStars = useCallback(async () => {
    const data = await api.get<StarsPayload>("/api/stars");
    setPayload(data);

    const n = data.count;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const pinned = new Uint8Array(n);
    const priv = new Uint8Array(n);
    const color: string[] = new Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = data.x[i];
      y[i] = data.y[i];
      pinned[i] = data.pinned[i];
      priv[i] = data.private[i];
      const ci = data.cluster[i];
      color[i] = ci >= 0 ? (data.clusters[ci]?.color ?? UNFILED_COLOR) : UNFILED_COLOR;
    }

    // Entries with no layout yet would stack on one pixel; spread them on a
    // phyllotaxis spiral so the view is still usable before the first relax.
    let allZero = true;
    for (let i = 0; i < n; i++) {
      if (x[i] !== 0 || y[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero && n > 1) {
      for (let i = 0; i < n; i++) {
        const a = i * 2.399963;
        const r = 26 * Math.sqrt(i + 1);
        x[i] = Math.cos(a) * r;
        y[i] = Math.sin(a) * r;
      }
    }

    const edges = new Int32Array(data.edges);
    const counts = new Int32Array(n);
    for (let e = 0; e < edges.length; e += 3) {
      counts[edges[e]]++;
      counts[edges[e + 1]]++;
    }
    const edgesOf: Int32Array[] = new Array(n);
    const fill = new Int32Array(n);
    for (let i = 0; i < n; i++) edgesOf[i] = new Int32Array(counts[i]);
    for (let e = 0; e < edges.length; e += 3) {
      const a = edges[e];
      const b = edges[e + 1];
      edgesOf[a][fill[a]++] = e;
      edgesOf[b][fill[b]++] = e;
    }

    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const key = cellKey(Math.floor(x[i] / CELL), Math.floor(y[i] / CELL));
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    dataRef.current = {
      n,
      x,
      y,
      color,
      pinned,
      priv,
      titles: data.titles,
      ids: data.ids,
      edges,
      edgesOf,
      grid,
      regions: data.regions,
    };
    fit();
  }, []);

  useEffect(() => {
    loadStars().catch((err) => setStatus((err as Error).message));
  }, [loadStars]);

  function cellKey(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  function rebuildGrid() {
    const d = dataRef.current;
    if (!d) return;
    d.grid.clear();
    for (let i = 0; i < d.n; i++) {
      const key = cellKey(Math.floor(d.x[i] / CELL), Math.floor(d.y[i] / CELL));
      const bucket = d.grid.get(key);
      if (bucket) bucket.push(i);
      else d.grid.set(key, [i]);
    }
  }

  function fit() {
    const canvas = canvasRef.current;
    const d = dataRef.current;
    if (!canvas || !d || d.n === 0) return;
    const rect = canvas.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < d.n; i++) {
      if (d.x[i] < minX) minX = d.x[i];
      if (d.y[i] < minY) minY = d.y[i];
      if (d.x[i] > maxX) maxX = d.x[i];
      if (d.y[i] > maxY) maxY = d.y[i];
    }
    const pad = 70;
    const scale = Math.min((rect.width - pad * 2) / Math.max(1, maxX - minX), (rect.height - pad * 2) / Math.max(1, maxY - minY));
    camRef.current = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      scale: Math.max(0.02, Math.min(Number.isFinite(scale) && scale > 0 ? scale : 1, 2)),
    };
    dirtyRef.current = true;
  }

  // --- render loop --------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      setStatus("This browser cannot draw a canvas. The Read screen shows the same entries.");
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    let frames = 0;
    let lastFpsAt = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      dirtyRef.current = true;
    };
    resize();
    window.addEventListener("resize", resize);

    const toScreen = (wx: number, wy: number): [number, number] => {
      const cam = camRef.current;
      return [(wx - cam.x) * cam.scale + w / 2, (wy - cam.y) * cam.scale + h / 2];
    };
    const toWorld = (sx: number, sy: number): [number, number] => {
      const cam = camRef.current;
      return [(sx - w / 2) / cam.scale + cam.x, (sy - h / 2) / cam.scale + cam.y];
    };

    const visibleIndices = (): number[] => {
      const d = dataRef.current;
      if (!d) return [];
      const [wx0, wy0] = toWorld(-40, -40);
      const [wx1, wy1] = toWorld(w + 40, h + 40);
      const out: number[] = [];
      const cx0 = Math.floor(wx0 / CELL);
      const cx1 = Math.floor(wx1 / CELL);
      const cy0 = Math.floor(wy0 / CELL);
      const cy1 = Math.floor(wy1 / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const bucket = d.grid.get(cellKey(cx, cy));
          if (bucket) for (let k = 0; k < bucket.length; k++) out.push(bucket[k]);
        }
      }
      return out;
    };

    (canvas as HTMLCanvasElement & { __visible?: () => number[] }).__visible = visibleIndices;
    (canvas as HTMLCanvasElement & { __toScreen?: unknown }).__toScreen = toScreen;
    (canvas as HTMLCanvasElement & { __toWorld?: unknown }).__toWorld = toWorld;

    const draw = () => {
      const d = dataRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0a0b10";
      ctx.fillRect(0, 0, w, h);
      if (!d) return;
      const cam = camRef.current;

      // regions: glow
      for (const rg of d.regions) {
        const [cx, cy] = toScreen(rg.x, rg.y);
        const rad = Math.max(10, rg.radius * cam.scale);
        if (cx + rad < 0 || cx - rad > w || cy + rad < 0 || cy - rad > h) continue;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, hexToRgba(rg.color, 0.18));
        grad.addColorStop(1, hexToRgba(rg.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      const vis = visibleIndices();
      setVisibleThrottled(vis.length);

      // The whole archive can be in view at once when zoomed out, so the hot
      // loops below transform inline (sx = x * scale + ox) instead of
      // allocating a coordinate pair per point per frame. At 5,000 points and
      // 60 frames a second, that allocation is the difference on a phone.
      const scale = cam.scale;
      const ox = w / 2 - cam.x * scale;
      const oy = h / 2 - cam.y * scale;

      // threads: faint at distance, skipped entirely when far out
      if (scale > 0.16) {
        ctx.strokeStyle = "rgba(150,162,192,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        let drawn = 0;
        for (let v = 0; v < vis.length && drawn < 4000; v++) {
          const i = vis[v];
          const list = d.edgesOf[i];
          for (let k = 0; k < list.length; k++) {
            const e = list[k];
            if (d.edges[e] !== i) continue; // draw each edge once
            const a = d.edges[e];
            const b = d.edges[e + 1];
            ctx.moveTo(d.x[a] * scale + ox, d.y[a] * scale + oy);
            ctx.lineTo(d.x[b] * scale + ox, d.y[b] * scale + oy);
            drawn++;
          }
        }
        ctx.stroke();
      }

      // stars, batched by colour so the context changes state rarely
      const r = scale < 0.25 ? 1.1 : scale < 0.6 ? 1.8 : 2.7;
      const byColor = new Map<string, number[]>();
      for (let v = 0; v < vis.length; v++) {
        const i = vis[v];
        const list = byColor.get(d.color[i]);
        if (list) list.push(i);
        else byColor.set(d.color[i], [i]);
      }
      const useRects = scale < 0.6;
      for (const [color, list] of byColor) {
        ctx.fillStyle = color;
        if (useRects) {
          // Squares under two pixels are indistinguishable from circles and
          // cost a fraction as much to rasterise.
          const size = r * 2;
          for (let k = 0; k < list.length; k++) {
            const i = list[k];
            ctx.fillRect(d.x[i] * scale + ox - r, d.y[i] * scale + oy - r, size, size);
          }
        } else {
          ctx.beginPath();
          for (let k = 0; k < list.length; k++) {
            const i = list[k];
            const sx = d.x[i] * scale + ox;
            const sy = d.y[i] * scale + oy;
            ctx.moveTo(sx + r, sy);
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }

      // pinned rings
      if (scale > 0.4) {
        ctx.strokeStyle = "rgba(244,230,189,0.65)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let v = 0; v < vis.length; v++) {
          const i = vis[v];
          if (!d.pinned[i]) continue;
          const sx = d.x[i] * scale + ox;
          const sy = d.y[i] * scale + oy;
          ctx.moveTo(sx + r + 3, sy);
          ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
        }
        ctx.stroke();
      }

      // titles, only when there are few enough to read
      if (scale > 0.6 && vis.length < 420) {
        ctx.fillStyle = "rgba(226,220,206,0.8)";
        ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
        for (let v = 0; v < vis.length; v++) {
          const i = vis[v];
          ctx.fillText(d.titles[i].slice(0, 36), d.x[i] * scale + ox + 6, d.y[i] * scale + oy + 3.5);
        }
      }

      // the selected star and its threads, bright
      const sel = selectedRef.current;
      if (sel !== null && sel < d.n) {
        const list = d.edgesOf[sel];
        ctx.strokeStyle = "rgba(232,207,146,0.8)";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let k = 0; k < list.length; k++) {
          const e = list[k];
          const [ax, ay] = toScreen(d.x[d.edges[e]], d.y[d.edges[e]]);
          const [bx, by] = toScreen(d.x[d.edges[e + 1]], d.y[d.edges[e + 1]]);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
        const [sx, sy] = toScreen(d.x[sel], d.y[sel]);
        ctx.fillStyle = "#f7ecd0";
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // region names, while they are the level of detail that matters
      if (cam.scale < 0.62) {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(240,234,220,0.85)";
        ctx.font = '600 13px -apple-system, "Segoe UI", Roboto, sans-serif';
        for (const rg of d.regions) {
          if (!rg.count) continue;
          const [cx, cy] = toScreen(rg.x, rg.y);
          if (cx < -120 || cx > w + 120 || cy < -30 || cy > h + 30) continue;
          ctx.fillText(`${rg.name} (${rg.count})`, cx, cy);
        }
        ctx.textAlign = "left";
      }
    };

    const loop = () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
      frames++;
      const now = performance.now();
      if (now - lastFpsAt > 1000) {
        setFps(Math.round((frames * 1000) / (now - lastFpsAt)));
        frames = 0;
        lastFpsAt = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [payload]);

  // Throttled through a ref: the count is a readout, and it must never be
  // able to trigger a render inside the draw loop.
  function setVisibleThrottled(n: number) {
    if (visibleTimerRef.current) return;
    visibleTimerRef.current = window.setTimeout(() => {
      visibleTimerRef.current = 0;
      setVisible(n);
    }, 400);
  }

  // --- interaction --------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const helpers = canvas as HTMLCanvasElement & {
      __visible?: () => number[];
      __toScreen?: (x: number, y: number) => [number, number];
      __toWorld?: (x: number, y: number) => [number, number];
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let panStart: { sx: number; sy: number; cx: number; cy: number } | null = null;
    let pinch: { dist: number; scale: number } | null = null;
    let moved = 0;

    const nearest = (sx: number, sy: number, maxPx: number): number | null => {
      const d = dataRef.current;
      if (!d || !helpers.__visible || !helpers.__toScreen) return null;
      const vis = helpers.__visible();
      // Transform inline, as in the draw loop: this runs on every pointermove.
      const rect = canvas.getBoundingClientRect();
      const cam = camRef.current;
      const ox = rect.width / 2 - cam.x * cam.scale;
      const oy = rect.height / 2 - cam.y * cam.scale;
      let best: number | null = null;
      let bestD = maxPx * maxPx;
      for (const i of vis) {
        const px = d.x[i] * cam.scale + ox;
        const py = d.y[i] * cam.scale + oy;
        const dist = (px - sx) ** 2 + (py - sy) ** 2;
        if (dist < bestD) {
          bestD = dist;
          best = i;
        }
      }
      return best;
    };

    const onDown = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: camRef.current.scale };
        panStart = null;
        draggingRef.current = null;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const hit = nearest(ev.clientX - rect.left, ev.clientY - rect.top, 14);
      if (hit !== null && camRef.current.scale > 0.35) {
        draggingRef.current = { index: hit, moved: false };
      } else {
        panStart = { sx: ev.clientX, sy: ev.clientY, cx: camRef.current.x, cy: camRef.current.y };
        canvas.className = "dragging";
      }
    };

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!pointers.has(ev.pointerId)) {
        // hover tooltip
        const d = dataRef.current;
        const tip = tipRef.current;
        if (!d || !tip || !helpers.__toScreen) return;
        const hit = nearest(ev.clientX - rect.left, ev.clientY - rect.top, 14);
        if (hit === null) {
          tip.style.display = "none";
        } else {
          const [px, py] = helpers.__toScreen(d.x[hit], d.y[hit]);
          tip.textContent = d.titles[hit];
          tip.style.display = "block";
          tip.style.left = `${Math.max(4, px + 10)}px`;
          tip.style.top = `${Math.max(4, py - 34)}px`;
        }
        return;
      }
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.dist > 0) {
          camRef.current.scale = clamp(pinch.scale * (dist / pinch.dist), 0.02, 8);
          dirtyRef.current = true;
        }
        moved = 99;
        return;
      }

      const drag = draggingRef.current;
      if (drag && helpers.__toWorld) {
        const [wx, wy] = helpers.__toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
        const d = dataRef.current!;
        d.x[drag.index] = wx;
        d.y[drag.index] = wy;
        drag.moved = true;
        moved += 10;
        dirtyRef.current = true;
        return;
      }

      if (panStart) {
        const dx = ev.clientX - panStart.sx;
        const dy = ev.clientY - panStart.sy;
        moved += Math.abs(dx) + Math.abs(dy);
        camRef.current.x = panStart.cx - dx / camRef.current.scale;
        camRef.current.y = panStart.cy - dy / camRef.current.scale;
        dirtyRef.current = true;
      }
    };

    const onUp = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const drag = draggingRef.current;
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;

      if (drag) {
        const d = dataRef.current!;
        if (drag.moved) {
          // Dragging a star pins it: the author's arrangement outranks the
          // layout algorithm and survives every future relax.
          d.pinned[drag.index] = 1;
          rebuildGrid();
          dirtyRef.current = true;
          void api
            .patch(`/api/entries/${d.ids[drag.index]}`, {
              position: { x: d.x[drag.index], y: d.y[drag.index], pinned: true },
            })
            .then(() => setStatus("Pinned. It stays where you put it."))
            .catch((err) => setStatus(`Could not save that position: ${(err as Error).message}`));
        } else {
          selectedRef.current = drag.index;
          setSelected(drag.index);
          dirtyRef.current = true;
        }
        draggingRef.current = null;
        return;
      }

      if (panStart && moved < 6) {
        const hit = nearest(ev.clientX - rect.left, ev.clientY - rect.top, 16);
        selectedRef.current = hit;
        setSelected(hit);
        dirtyRef.current = true;
      }
      panStart = null;
      canvas.className = "";
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      if (!helpers.__toWorld) return;
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const before = helpers.__toWorld(sx, sy);
      camRef.current.scale = clamp(camRef.current.scale * Math.exp(-ev.deltaY * 0.0016), 0.02, 8);
      const after = helpers.__toWorld(sx, sy);
      camRef.current.x += before[0] - after[0];
      camRef.current.y += before[1] - after[1];
      dirtyRef.current = true;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [payload]);

  async function relax(fresh: boolean) {
    setBusy(true);
    setStatus("Relaxing the layout against the connection graph…");
    try {
      const r = await api.post<{ nodes: number; tookMs: number; pinned: number }>(`/api/layout?fresh=${fresh ? 1 : 0}`);
      setStatus(`Placed ${r.nodes} entries in ${r.tookMs}ms (${r.pinned} pinned by you, left alone).`);
      await loadStars();
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rethread() {
    setBusy(true);
    setStatus("Recomputing connections for every entry…");
    try {
      const r = await api.post<{ entries: number; vectorLinks: number; lexicalLinks: number; basis: string; tookMs: number }>(
        "/api/rethread",
      );
      setStatus(
        `Rethreaded ${r.entries} entries in ${Math.round(r.tookMs / 100) / 10}s — ${r.vectorLinks} by similarity, ${r.lexicalLinks} by shared words (${r.basis}).`,
      );
      await loadStars();
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const d = dataRef.current;
  const selectedId = selected !== null && d ? d.ids[selected] : null;

  return (
    <div>
      <div id="sky-wrap">
        <canvas id="sky" ref={canvasRef} />
        <div className="sky-tip" ref={tipRef} />
        <div className="sky-controls">
          <button onClick={() => { camRef.current.scale = clamp(camRef.current.scale * 1.4, 0.02, 8); dirtyRef.current = true; }}>
            +
          </button>
          <button onClick={() => { camRef.current.scale = clamp(camRef.current.scale / 1.4, 0.02, 8); dirtyRef.current = true; }}>
            −
          </button>
          <button onClick={() => fit()}>Fit</button>
          <button onClick={() => void relax(false)} disabled={busy}>
            Relax layout
          </button>
          <button onClick={() => void rethread()} disabled={busy}>
            Rethread
          </button>
        </div>
        <div className="sky-hud">
          {payload ? `${payload.count} entries · ${visible} in view · ${fps} fps` : "loading…"}
        </div>
      </div>

      <div style={{ marginTop: "0.8rem", minHeight: "4.5rem" }}>
        {selectedId && d ? (
          <div className="card">
            <div className="t">{d.titles[selected!]}</div>
            <div className="meta">
              {d.priv[selected!] ? <span className="badge private">private</span> : null}
              {d.pinned[selected!] ? <span className="badge">pinned by you</span> : null}
              <span>{d.edgesOf[selected!].length} connections</span>
            </div>
            <div style={{ marginTop: "0.6rem" }}>
              <Link href={`/entries/${selectedId}`}>Read this entry →</Link>
            </div>
          </div>
        ) : (
          <p className="note">
            Click a point to see what it is. Drag one (zoomed in) to pin it where you want it. Nearness means shared
            words, not shared meaning.
          </p>
        )}
        {status && <p className="note">{status}</p>}
        {payload && payload.unpositioned > payload.count / 2 && payload.count > 1 && (
          <p className="note">
            {payload.unpositioned} entries have no computed position yet. Press <b>Relax layout</b> to arrange them by
            what they have in common.
          </p>
        )}
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || "#9fb0c8").replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const num = Number.parseInt(h, 16);
  if (Number.isNaN(num)) return `rgba(159,176,200,${alpha})`;
  return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
}
