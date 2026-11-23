import { useEffect, useRef } from "react";
import { Link, NavLink } from "react-router-dom";
import { BrandMark } from "../Brand";
import { Analytics, fmtInt, useAnalytics, useMeta } from "../data";

/* ------------------------------------------------------------------------------------------
   Dot-matrix hero. A chart of the real monthly revenue is painted into two tiny offscreen
   "fields" (one pixel = one dot), then redrawn every frame as an LED halftone of horizontal
   scanline rows. Field A is the RAW data (spikes, gaps, duplicate ghost line, orphan rows,
   drawn in the flag colour). Field B is the CLEAN data plus the forecast. Each half of the
   screen periodically dissolves dot by dot from one to the other, and the cursor opens a lens
   that shows the opposite state.
------------------------------------------------------------------------------------------- */

const LOOP = 20;
const LEVELS = [0, 0.26, 0.52, 0.78, 1];
const TAU = Math.PI * 2;
const FLAG = "rgb(110,60,10)"; // a dark orange, recognised in the field by R - B

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixAt = (t: number, on: number, off: number, dur: number) => smooth(on, on + dur, t) * (1 - smooth(off, off + dur, t));
const fract = (x: number) => x - Math.floor(x);
const hash = (a: number, b: number) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

type Series = { actual: number[]; fc: { v: number; lo: number; hi: number }[]; vmax: number };

function buildSeries(an: Analytics | null): Series {
  let actual: number[]; let fc: Series["fc"];
  if (an) {
    const m: Record<string, number> = {};
    an.anomalies.series.forEach((d) => { const k = d.d.slice(0, 7); m[k] = (m[k] || 0) + d.revenue; });
    actual = Object.keys(m).sort().map((k) => m[k]);
    fc = an.forecast.forecast.map((f) => ({ v: f.revenue, lo: f.low, hi: f.high }));
  } else { // shown for a moment while the real data loads
    actual = Array.from({ length: 24 }, (_, i) => 24e6 * Math.exp(0.021 * i) * (i % 12 >= 9 ? 1.32 : 1));
    const last = actual[23]; fc = [1, 2, 3].map((k) => ({ v: last * 0.78 * (1 + 0.02 * k), lo: last * 0.7, hi: last * 0.88 }));
  }
  return { actual, fc, vmax: Math.max(...actual, ...fc.map((f) => f.hi)) * 1.03 };
}

function geom(fw: number, fh: number, S: Series, breathe: number) {
  const n = S.actual.length + S.fc.length, padL = fw * 0.015, padR = fw * 0.015;
  const yTop = fh * 0.385, yBot = fh * 0.775;
  return { n, yTop, yBot, x: (i: number) => padL + (i / (n - 1)) * (fw - padL - padR), y: (v: number) => yBot - (v / S.vmax) * (yBot - yTop) * breathe };
}

type RawNoise = { jx: number[]; jy: number[]; spikes: { i: number; h: number }[]; gaps: { x: number; w: number }[]; strays: { x: number; y: number }[] };
function makeRaw(fw: number, fh: number, S: Series): RawNoise {
  const r = mulberry(11), n = S.actual.length;
  const spikeAt = [3, 8, 12, 16, 19, 22].filter((i) => i < n);
  return {
    jx: S.actual.map(() => (r() - 0.5) * fw * 0.006), jy: S.actual.map(() => (r() - 0.5) * fh * 0.045),
    spikes: spikeAt.map((i) => ({ i, h: fh * (0.09 + r() * 0.12) })),
    gaps: [0.11, 0.33, 0.52, 0.74].map((p) => ({ x: fw * (p + (r() - 0.5) * 0.03), w: 2 + Math.floor(r() * 2) })),
    strays: Array.from({ length: 46 }, () => ({ x: r() * fw, y: fh * (0.42 + r() * 0.42) })),
  };
}

function gradientFill(c: CanvasRenderingContext2D, top: number, bottom: number) {
  const g = c.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, "rgb(105,105,105)"); g.addColorStop(1, "rgb(196,196,196)");
  c.fillStyle = g;
}

function gridTicks(c: CanvasRenderingContext2D, G: ReturnType<typeof geom>) {
  c.strokeStyle = "rgb(186,186,186)"; c.lineWidth = 0.8; c.beginPath();
  for (let i = 0; i < G.n; i += 3) { c.moveTo(G.x(i), G.yBot - (G.yBot - G.yTop) * 0.82); c.lineTo(G.x(i), G.yBot + 1.5); }
  c.stroke();
  c.strokeStyle = "rgb(150,150,150)"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, G.yBot + 1.5); c.lineTo(c.canvas.width, G.yBot + 1.5); c.stroke();
}

function paintClean(c: CanvasRenderingContext2D, fw: number, fh: number, S: Series, breathe: number, reveal: number) {
  c.fillStyle = "#fff"; c.fillRect(0, 0, fw, fh);
  const G = geom(fw, fh, S, breathe), na = S.actual.length;
  c.save(); c.beginPath(); c.rect(0, 0, fw * reveal, fh); c.clip();
  gridTicks(c, G);
  c.beginPath(); c.moveTo(G.x(0), G.yBot);
  S.actual.forEach((v, i) => c.lineTo(G.x(i), G.y(v)));
  c.lineTo(G.x(na - 1), G.yBot); c.closePath(); gradientFill(c, G.yTop, G.yBot); c.fill();
  // forecast band, dashed forecast line
  c.beginPath(); c.moveTo(G.x(na - 1), G.y(S.actual[na - 1]));
  S.fc.forEach((f, k) => c.lineTo(G.x(na + k), G.y(f.hi)));
  for (let k = S.fc.length - 1; k >= 0; k--) c.lineTo(G.x(na + k), G.y(S.fc[k].lo));
  c.closePath(); c.fillStyle = "rgb(176,176,176)"; c.fill();
  c.strokeStyle = "rgb(40,40,40)"; c.lineWidth = 1.3; c.setLineDash([2.2, 1.7]); c.beginPath(); c.moveTo(G.x(na - 1), G.y(S.actual[na - 1]));
  S.fc.forEach((f, k) => c.lineTo(G.x(na + k), G.y(f.v))); c.stroke(); c.setLineDash([]);
  c.strokeStyle = "rgb(12,12,12)"; c.lineWidth = 1.6; c.lineJoin = "round"; c.beginPath();
  S.actual.forEach((v, i) => (i ? c.lineTo(G.x(i), G.y(v)) : c.moveTo(G.x(i), G.y(v)))); c.stroke();
  c.fillStyle = "rgb(0,0,0)"; c.beginPath(); c.arc(G.x(na - 1), G.y(S.actual[na - 1]), 2, 0, TAU); c.fill();
  c.restore();
}

function paintRaw(c: CanvasRenderingContext2D, fw: number, fh: number, S: Series, breathe: number, reveal: number, N: RawNoise, tick: number) {
  c.fillStyle = "#fff"; c.fillRect(0, 0, fw, fh);
  const G = geom(fw, fh, S, breathe), na = S.actual.length;
  const pts = S.actual.map((v, i) => ({ x: G.x(i) + N.jx[i], y: G.y(v) + N.jy[i] }));
  c.save(); c.beginPath(); c.rect(0, 0, fw * reveal, fh); c.clip();
  gridTicks(c, G);
  c.beginPath(); c.moveTo(pts[0].x, G.yBot); pts.forEach((p) => c.lineTo(p.x, p.y)); c.lineTo(pts[na - 1].x, G.yBot); c.closePath();
  gradientFill(c, G.yTop, G.yBot); c.fill();
  c.lineJoin = "round"; c.lineWidth = 1.6; c.strokeStyle = "rgb(12,12,12)"; c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
  c.strokeStyle = FLAG; c.lineWidth = 1.2; c.beginPath();   // duplicate ghost
  pts.forEach((p, i) => (i ? c.lineTo(p.x + 1.8, p.y - 1.2) : c.moveTo(p.x + 1.8, p.y - 1.2))); c.stroke();
  c.fillStyle = "#fff"; N.gaps.forEach((g) => c.fillRect(g.x, G.yTop - 10, g.w, G.yBot - G.yTop + 10)); // missing values
  c.fillStyle = FLAG; N.spikes.forEach((s) => c.fillRect(pts[s.i].x - 0.7, pts[s.i].y - s.h, 1.5, s.h + (G.yBot - pts[s.i].y))); // outliers
  N.strays.forEach((s, k) => { if (hash(k, tick) > 0.35) c.fillRect(s.x, s.y, 1.3, 1.3); }); // orphan rows
  c.restore();
}

export default function Home({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const heroRef = useRef<HTMLElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const { data: meta } = useMeta();
  const { data: an } = useAnalytics();
  const seriesRef = useRef<Series>(buildSeries(null));
  const verRef = useRef(0);
  const colorRef = useRef({ ink: "#0d0d0d", flag: "#eb6834" });

  useEffect(() => { seriesRef.current = buildSeries(an); verRef.current++; }, [an]);
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    colorRef.current = { ink: cs.getPropertyValue("--hero-dot").trim() || "#0d0d0d", flag: cs.getPropertyValue("--hero-flag").trim() || "#eb6834" };
  }, [dark]);

  useEffect(() => {
    const hero = heroRef.current!, cv = cvRef.current!, ctx = cv.getContext("2d")!;
    const fA = document.createElement("canvas"), fB = document.createElement("canvas");
    const cA = fA.getContext("2d", { willReadFrequently: true })!, cB = fB.getContext("2d", { willReadFrequently: true })!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, DPR = 1, step = 7, rowStep = 14, cols = 0, rows = 0, R = 3;
    let seeds = new Float32Array(0), shifts = new Int8Array(0);
    let noise = makeRaw(1, 1, seriesRef.current), noiseVer = -1, raf = 0;
    const ptr = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4, on: false, r: 0 };

    const resize = () => {
      const b = hero.getBoundingClientRect(); W = b.width; H = b.height; DPR = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      step = Math.max(5, W / 205); rowStep = step * 2.05; cols = Math.ceil(W / step); rows = Math.ceil(H / rowStep); R = step * 0.46;
      fA.width = fB.width = cols; fA.height = fB.height = rows;
      seeds = new Float32Array(cols * rows); shifts = new Int8Array(rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) seeds[j * cols + i] = 0.55 * hash(i, j) + 0.45 * hash(j * 3.1, 7.7);
      noiseVer = -1;
      if (reduce) render(8.4, 99);
    };

    function render(t: number, real: number) {
      if (!cols) return;
      const T = ((t % LOOP) + LOOP) % LOOP, a = (TAU * T) / LOOP, tick = Math.floor(T * 7);
      const reveal = reduce ? 1 : smooth(0.15, 2.8, real), breathe = 1 + 0.03 * Math.sin(a);
      if (noiseVer !== verRef.current) { noise = makeRaw(cols, rows, seriesRef.current); noiseVer = verRef.current; }
      paintRaw(cA, cols, rows, seriesRef.current, breathe, reveal, noise, tick);
      paintClean(cB, cols, rows, seriesRef.current, breathe, reveal);
      const dA = cA.getImageData(0, 0, cols, rows).data, dB = cB.getImageData(0, 0, cols, rows).data;

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
      const mL = mixAt(T, 3.0, 12.4, 1.6), mR = mixAt(T, 4.4, 13.8, 1.6);
      for (let j = 0; j < rows; j++) shifts[j] = hash(j, tick) > 0.965 ? Math.round((hash(tick, j) - 0.5) * 8) : 0;
      ptr.sx += (ptr.x - ptr.sx) * 0.2; ptr.sy += (ptr.y - ptr.sy) * 0.2;
      ptr.r += ((ptr.on ? Math.min(W, H) * 0.17 : 0) - ptr.r) * 0.14;
      const portrait = H > W, qx = portrait ? 0.5 : 0.29, qy = portrait ? 0.16 : 0.155, qc = portrait ? 0.35 : 0.39;
      const ink = new Path2D(), flag = new Path2D();

      for (let j = 0; j < rows; j++) {
        const py = (j + 0.5) * rowStep, ey = (py / H - qc) / qy;
        for (let i = 0; i < cols; i++) {
          const seed = seeds[j * cols + i], m = i < cols / 2 ? mL : mR;
          let useB = seed < m;
          const px = (i + 0.5) * step;
          if (ptr.r > 1) { const dx = px - ptr.sx, dy = py - ptr.sy; if (dx * dx + dy * dy < ptr.r * ptr.r) useB = !useB; }
          const si = Math.max(0, Math.min(cols - 1, i - shifts[j]));
          const o = (j * cols + si) * 4, d = useB ? dB : dA;
          const lum = d[o] / 255;
          let v = Math.max(0, Math.min(1, (1 - lum - 0.16) / 0.42));
          if (v <= 0) continue;
          v *= 0.86 + 0.14 * Math.sin(T * 3.2 + seed * 40);
          if (m > 0.001 && m < 0.999) { const df = Math.abs(seed - m); if (df < 0.12) { v *= df / 0.12; if (hash(i + tick, j) <= 0.4) v *= 0.3; } }
          const cxn = Math.abs((i + 0.5) / cols - 0.5), ex = cxn / qx;
          v *= smooth(0.85, 1.25, Math.hypot(ex, ey));
          const beam = Math.exp(-Math.pow((i / cols - fract(T / LOOP * 1.15 - 0.08)) * 38, 2)); // the "scan" passing over the data
          v = Math.min(1, v * (1 + 0.45 * beam));
          let lvl = 0;
          for (let k = LEVELS.length - 1; k > 0; k--) if (v >= LEVELS[k] - 0.13) { lvl = LEVELS[k]; break; }
          if (lvl === 0) continue;
          const r = lvl === LEVELS[1] ? R * 0.38 : R * lvl, x = px;
          const isFlag = !useB && d[o] - d[o + 2] > 38;
          const path = isFlag ? flag : ink;
          path.moveTo(x + r, py); path.arc(x, py, r, 0, TAU);
        }
      }
      ctx.fillStyle = colorRef.current.ink; ctx.fill(ink);
      ctx.fillStyle = colorRef.current.flag; ctx.fill(flag);
      if (ptr.r > 4) { ctx.strokeStyle = colorRef.current.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(ptr.sx, ptr.sy, ptr.r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    }

    const t0 = performance.now();
    const loop = (now: number) => { if (!document.hidden) render((now - t0) / 1000, (now - t0) / 1000); raf = requestAnimationFrame(loop); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(hero);
    if (!reduce) raf = requestAnimationFrame(loop);
    (window as unknown as { __render: (t: number) => void }).__render = (t) => { cancelAnimationFrame(raf); render(t, t); };

    const onMove = (e: PointerEvent) => { if (e.pointerType === "touch") return; const b = hero.getBoundingClientRect(); ptr.x = e.clientX - b.left; ptr.y = e.clientY - b.top; if (!ptr.on) { ptr.sx = ptr.x; ptr.sy = ptr.y; } ptr.on = true; };
    const onLeave = () => { ptr.on = false; };
    hero.addEventListener("pointermove", onMove); hero.addEventListener("pointerleave", onLeave);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); hero.removeEventListener("pointermove", onMove); hero.removeEventListener("pointerleave", onLeave); };
  }, []);

  const c = meta?.cleaning;
  const matched = meta ? meta.ground_truth.filter((g) => g.match).length : 0;
  const links = [["Overview", "/overview"], ["Data quality", "/quality"], ["Quarantine", "/quarantine"], ["Customers", "/customers"], ["Insights", "/insights"], ["Pipeline", "/pipeline"]];

  return (
    <section className="hero" ref={heroRef}>
      <canvas ref={cvRef} className="hero-canvas" aria-hidden />
      <nav className="hnav" aria-label="Main">
        <Link to="/" className="hbrand"><BrandMark size={24} />RetailIQ</Link>
        <div className="hlinks">{links.map(([l, to]) => <NavLink key={to} to={to}>{l}</NavLink>)}</div>
        <div className="hright">
          <button className="hicon" onClick={onToggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />}
            </svg>
          </button>
          <Link to="/overview" className="hpill">Open dashboard</Link>
        </div>
      </nav>

      <div className="hcopy">
        <h1><span>Every row</span>accounted for.</h1>
        <p>RetailIQ cleans messy order data, quarantines every bad row with a reason, and shows you what is left.</p>
        <div className="hcta"><Link to="/overview">Explore the data</Link></div>
      </div>

      <p className="hhint">Move your cursor over the chart to flip between raw and clean. Orange marks a defect.</p>
      <div className="hstats">
        <div><b>{c ? fmtInt(c.raw_rows) : "255,000"}</b><span>raw order rows in</span></div>
        <div><b>{c ? fmtInt(c.duplicates_removed) : "5,000"}</b><span>exact duplicates dropped</span></div>
        <div><b>{c ? fmtInt(c.quarantined) : "5,500"}</b><span>quarantined, each with a reason</span></div>
        <div><b>{meta ? `${matched} of ${meta.ground_truth.length}` : "11 of 11"}</b><span>defect counts match the truth</span></div>
      </div>
    </section>
  );
}
