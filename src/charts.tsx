import { EXPLAIN } from "./explain";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/* Hand-built SVG/HTML charts. Marks are thin, bars are anchored at zero with a rounded data end,
   fills are separated by a 2px surface gap, and every chart has a hover layer. */

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function ticks(min: number, max: number, n = 4) {
  const step = niceStep((max - min) / n || 1);
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; ; v += step) {
    out.push(+v.toFixed(6));
    if (v >= max - 1e-9) break;   // the last tick must reach the data maximum
  }
  return out;
}

export type Series = {
  name: string; color: string; values: (number | null)[]; dash?: boolean; band?: { lo: (number | null)[]; hi: (number | null)[] };
  width?: number;
};

export function LineChart({ labels, series, yFmt, xFmt = (s) => s, tipTitle = (s) => s, height = 260, markers = [], xEvery, area = false, endLabel = false, bands = [], onBrush }: {
  labels: string[]; series: Series[]; yFmt: (n: number) => string; xFmt?: (s: string) => string; tipTitle?: (s: string) => string;
  height?: number; markers?: { idx: number; label: string }[]; xEvery?: number;
  area?: boolean; endLabel?: boolean; bands?: { from: number; to: number; label?: string }[];
  /** drag across the plot to select a range of x positions (inclusive indices) */
  onBrush?: (i0: number, i1: number) => void;
}) {
  const [ref, w] = useWidth();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const m = { l: 58, r: 16, t: 10, b: 26 };
  const iw = w - m.l - m.r, ih = height - m.t - m.b, n = labels.length;
  const all = series.flatMap((s) => [...s.values, ...(s.band ? [...s.band.lo, ...s.band.hi] : [])]).filter((v): v is number => v != null);
  const yt = ticks(0, Math.max(...all));
  const ymax = yt[yt.length - 1];
  const stepX = n > 1 ? iw / (n - 1) : iw;
  const x = (i: number) => m.l + (n === 1 ? iw / 2 : i * stepX);
  const y = (v: number) => m.t + ih - (v / ymax) * ih;
  const path = (vals: (number | null)[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const every = xEvery ?? Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 62))));
  const idxAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left - m.l) / iw) * (n - 1))));
  };
  const showLegend = series.length >= 2;
  const tipLeft = hover != null && x(hover) > w * 0.62;
  const lead = series[0];
  const lastIdx = lead.values.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
  return (
    <div ref={ref} className="chart">
      {showLegend && (
        <div className="legend">
          {series.map((s) => <span key={s.name}><i className={s.dash ? "sw dash" : "sw"} style={{ color: s.color }} />{s.name}</span>)}
        </div>
      )}
      <svg width={w} height={height} role="img" style={{ touchAction: "pan-y", cursor: onBrush ? "crosshair" : undefined }}
           onPointerDown={onBrush ? (e) => { const i = idxAt(e); setDrag({ a: i, b: i }); e.currentTarget.setPointerCapture?.(e.pointerId); } : undefined}
           onPointerMove={(e) => { const i = idxAt(e); setHover(i); if (drag) setDrag({ ...drag, b: i }); }}
           onPointerUp={() => { if (!drag) return; const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b); setDrag(null); if (onBrush && hi - lo >= 1) { setHover(null); onBrush(lo, hi); } }}
           onPointerLeave={() => { if (!drag) setHover(null); }}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={lead.color} stopOpacity="0.24" /><stop offset="1" stopColor={lead.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {bands.map((b, k) => (
          <g key={k}>
            <rect className="band" x={Math.max(m.l, x(b.from) - stepX / 2)} width={Math.max(0, Math.min(m.l + iw, x(b.to) + stepX / 2) - Math.max(m.l, x(b.from) - stepX / 2))} y={m.t} height={ih} />
            {b.label && (b.to - b.from + 1) * stepX > 70 && <text className="axis bandlabel" x={Math.max(m.l, x(b.from) - stepX / 2) + 6} y={m.t + 13}>{b.label}</text>}
          </g>
        ))}
        {yt.map((t) => (
          <g key={t}>
            <line className="grid" x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={m.l - 8} y={y(t) + 4} textAnchor="end">{yFmt(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => i % every === 0 && <text key={l} className="axis" x={x(i)} y={height - 6} textAnchor="middle">{xFmt(l)}</text>)}
        {series.map((s) => s.band && (
          <path key={s.name + "b"} d={(() => {
            const idx = s.band!.hi.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
            return `M${idx.map((i) => `${x(i)},${y(s.band!.hi[i]!)}`).join("L")}L${[...idx].reverse().map((i) => `${x(i)},${y(s.band!.lo[i]!)}`).join("L")}Z`;
          })()} fill={s.color} opacity={0.16} />
        ))}
        {area && lastIdx > 0 && <path className="areafade" d={`${path(lead.values)}L${x(lastIdx)},${y(0)}L${x(0)},${y(0)}Z`} fill={`url(#g${uid})`} />}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} pathLength={s.dash ? undefined : 1}
                className={s.dash ? undefined : "draw"} strokeDasharray={s.dash ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {markers.map((mk) => {
          const v = lead.values[mk.idx]; if (v == null) return null;
          return <circle key={mk.idx} cx={x(mk.idx)} cy={y(v)} r={4.5} className="marker" />;
        })}
        {endLabel && lastIdx >= 0 && (
          <g className="endlabel">
            <circle cx={x(lastIdx)} cy={y(lead.values[lastIdx]!)} r={4} fill={lead.color} className="ring" />
            <text x={x(lastIdx) - 8} y={y(lead.values[lastIdx]!) - 11} textAnchor="end" className="endtext">{yFmt(lead.values[lastIdx]!)}</text>
          </g>
        )}
        {drag && (
          <rect className="brush" x={x(Math.min(drag.a, drag.b))} width={Math.abs(x(drag.b) - x(drag.a))} y={m.t} height={ih} />
        )}
        {hover != null && !drag && (
          <g>
            <line className="cross" x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} />
            {series.map((s) => s.values[hover] != null && <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} className="ring" />)}
          </g>
        )}
      </svg>
      {hover != null && !drag && (
        <div className="tip" style={{ top: m.t + (showLegend ? 26 : 0), [tipLeft ? "right" : "left"]: tipLeft ? w - x(hover) + 12 : x(hover) + 12 }}>
          <b>{tipTitle(labels[hover])}</b>
          {series.map((s) => s.values[hover] != null && (
            <div key={s.name}><i className="sw" style={{ color: s.color }} />{series.length > 1 ? s.name + " " : ""}<span>{yFmt(s.values[hover]!)}</span></div>
          ))}
          {series[0].band && series[0].band.hi[hover] != null && <div className="muted">range {yFmt(series[0].band.lo[hover]!)} to {yFmt(series[0].band.hi[hover]!)}</div>}
          {markers.filter((mk) => mk.idx === hover).map((mk) => <div key="mk" className="flag">{mk.label}</div>)}
        </div>
      )}
    </div>
  );
}

export type Bar = { label: string; value: number; note?: string };
export function HBars({ items, fmt, selected, onSelect, labelWidth = 128, color = "var(--s1)", total, zeroBars = false }: {
  items: Bar[]; fmt: (n: number) => string; selected?: Set<string>; onSelect?: (label: string) => void;
  labelWidth?: number; color?: string; total?: number; zeroBars?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.value), zeroBars ? 0 : 1e-9);
  const sum = total ?? items.reduce((a, b) => a + b.value, 0);
  const active = selected && selected.size > 0;
  return (
    <div className="hbars">
      {items.map((it) => {
        const on = !active || selected!.has(it.label);
        return (
          <div key={it.label} className={"hrow" + (onSelect ? " clickable" : "") + (on ? "" : " dim")}
               onClick={onSelect ? () => onSelect(it.label) : undefined}
               role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined}
               onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(it.label); } } : undefined}
               aria-pressed={onSelect ? on && !!active : undefined}>
            <span className="hlabel" style={{ width: labelWidth }}>{it.label}</span>
            <span className="htrack"><span className="hbar" style={{ width: `${Math.max(0.6, (it.value / max) * 100)}%`, background: color }} /></span>
            <span className="hval">{fmt(it.value)}</span>
            <span className="tip rowtip"><b>{it.label}</b><div>{fmt(it.value)}{sum > 0 && <span className="muted"> · {((it.value / sum) * 100).toFixed(1)}% of total</span>}</div>{it.note && <div className="muted">{it.note}</div>}</span>
          </div>
        );
      })}
    </div>
  );
}

const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
export function Heatmap({ cells, rows, cols, rowLabel, colLabel, fmt = (n) => n.toLocaleString("en-US"), tip }: {
  cells: Record<string, number>; rows: number[]; cols: number[]; rowLabel: string; colLabel: string; fmt?: (n: number) => string;
  tip: (r: number, c: number, v: number) => string;
}) {
  const max = Math.max(...Object.values(cells), 1);
  return (
    <div className="heat" style={{ gridTemplateColumns: `auto repeat(${cols.length}, 1fr)` }}>
      {rows.map((r) => (
        <div key={r} style={{ display: "contents" }}>
          <span className="heat-axis">{r}</span>
          {cols.map((c) => {
            const v = cells[`${r}-${c}`] ?? 0, idx = Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 0.001)));
            return <span key={c} className="heat-cell" style={{ background: v ? RAMP[idx] : "var(--ground)", color: idx >= 3 ? "#fff" : "#0f1b26" }} tabIndex={0}>
              {v ? fmt(v) : ""}<span className="tip celltip">{tip(r, c, v)}</span></span>;
          })}
        </div>
      ))}
      <span />
      {cols.map((c) => <span key={c} className="heat-axis col">{c}</span>)}
      <span className="heat-title">{rowLabel} (rows), {colLabel} (columns)</span>
    </div>
  );
}

/* Reconciliation bar drawn as an LED dot matrix, the same motif as the landing page. Dots fill
   column by column so each part is one contiguous block; every dot stands for the same number of rows. */
export function Segments({ parts }: { parts: { label: string; value: number; color: string; note: string }[] }) {
  const [ref, w] = useWidth();
  const [hov, setHov] = useState<string | null>(null);
  const total = parts.reduce((a, b) => a + b.value, 0);
  const ROWS = 4, pitch = w < 600 ? 6 : 8, COLS = Math.max(40, Math.floor(w / pitch)), N = COLS * ROWS;
  const counts = parts.map((p) => Math.max(1, Math.round((p.value / total) * N)));
  const big = counts.indexOf(Math.max(...counts)); counts[big] += N - counts.reduce((a, b) => a + b, 0);
  const owner: number[] = []; counts.forEach((c, k) => { for (let n = 0; n < c; n++) owner.push(k); });
  const rowPitch = pitch * 1.55, r = pitch * 0.36;
  return (
    <div ref={ref}>
      <svg width={w} height={ROWS * rowPitch} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")} className="dotbar">
        {owner.map((k, n) => {
          const col = Math.floor(n / ROWS), row = n % ROWS, p = parts[k];
          return <circle key={n} cx={col * (w / COLS) + w / COLS / 2} cy={row * rowPitch + rowPitch / 2} r={r} fill={p.color}
                         opacity={hov && hov !== p.label ? 0.25 : 1} onMouseEnter={() => setHov(p.label)} onMouseLeave={() => setHov(null)} />;
        })}
      </svg>
      <div className="seg-legend">
        {parts.map((p) => (
          <div key={p.label} className={hov === p.label ? "on" : ""} onMouseEnter={() => setHov(p.label)} onMouseLeave={() => setHov(null)}>
            <i className="sw dot" style={{ color: p.color }} />
            <span className="seg-num">{p.value.toLocaleString("en-US")}</span>
            <span className="seg-label">{p.label}<span className="muted"> · {((p.value / total) * 100).toFixed(1)}%</span></span>
            <span className="muted seg-note">{p.note}</span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Each dot is about {Math.round(total / N).toLocaleString("en-US")} rows.</p>
    </div>
  );
}

export function Panel({ title, sub, children, actions, className = "", explain }: { title: string; sub?: string; children: ReactNode; actions?: ReactNode; className?: string; explain?: string }) {
  const note = EXPLAIN[explain ?? title];
  return (
    <section className={"panel " + className}>
      <header><div><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}
        {note && <p className="explain"><span><b>What:</b> {note.what}</span><span><b>Why it helps:</b> {note.why}</span></p>}</div>{actions}</header>
      {children}
    </section>
  );
}

/** Skeleton shown while a page's JSON loads. */
export function Loading() {
  return (
    <div className="skelwrap" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 34, width: 220 }} />
      <div className="skel" style={{ height: 18, width: "min(520px,80%)" }} />
      <div className="skel" style={{ height: 120 }} />
      <div className="skel" style={{ height: 300 }} />
    </div>
  );
}
