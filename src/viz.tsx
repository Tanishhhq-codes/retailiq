import { useState } from "react";
import { useWidth } from "./charts";

/* ---- tiny trend line used inside KPI tiles */
export function Sparkline({ values, w = 108, h = 30 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (w - 4), y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <path d={d} fill="none" stroke="var(--s1)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.6" fill="var(--s1)" className="ring" />
    </svg>
  );
}

/* ---- category x month dot matrix: dot area = revenue relative to that category's own best month */
export type DotRow = { label: string; values: number[]; total: number };
export function DotMatrix({ rows, cols, colFmt, fmt, selected, onSelect }: {
  rows: DotRow[]; cols: string[]; colFmt: (c: string) => string; fmt: (n: number) => string;
  selected: Set<string>; onSelect: (label: string) => void;
}) {
  const [ref, w] = useWidth();
  const [hov, setHov] = useState<{ r: number; c: number } | null>(null);
  const labelW = w < 560 ? 84 : 118, totalW = w < 560 ? 0 : 64, rowH = 30;
  const cw = (w - labelW - totalW) / cols.length, maxR = Math.min(cw, rowH) / 2 - 2;
  const every = Math.max(1, Math.ceil(46 / cw)), active = selected.size > 0;
  const height = rows.length * rowH + 26;
  const cx = (c: number) => labelW + cw * c + cw / 2, cy = (r: number) => r * rowH + rowH / 2;
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={height} role="img" aria-label="Revenue by category and month" onPointerLeave={() => setHov(null)}>
        {hov && <rect className="colhi" x={labelW + cw * hov.c} y={0} width={cw} height={rows.length * rowH} />}
        {rows.map((row, r) => {
          const best = Math.max(...row.values, 1e-9), low = Math.min(...row.values), on = !active || selected.has(row.label);
          return (
            <g key={row.label} opacity={on ? 1 : 0.3} className="dmrow" onClick={() => onSelect(row.label)} tabIndex={0} role="button"
               aria-pressed={active && on} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(row.label); } }}>
              <rect x={0} y={r * rowH} width={w} height={rowH} fill="transparent" />
              <text className="dmlabel" x={0} y={cy(r) + 4.5}>{row.label}</text>
              {row.values.map((v, c) => (
                <circle key={c} cx={cx(c)} cy={cy(r)} r={v > 0 ? 2.5 + (maxR - 2.5) * (best > low ? (v - low) / (best - low) : 1) : 0.8}
                        fill={v > 0 ? "var(--s1)" : "var(--line)"} onPointerEnter={() => setHov({ r, c })} />
              ))}
              {totalW > 0 && <text className="dmtotal" x={w} y={cy(r) + 4.5} textAnchor="end">{fmt(row.total)}</text>}
            </g>
          );
        })}
        {cols.map((c, i) => i % every === 0 && <text key={c} className="axis" x={cx(i)} y={height - 6} textAnchor="middle">{colFmt(c)}</text>)}
      </svg>
      {hov && (
        <div className="tip" style={{ top: cy(hov.r) + 18, left: Math.min(w - 190, Math.max(0, cx(hov.c) - 80)) }}>
          <b>{rows[hov.r].label} · {colFmt(cols[hov.c])}</b>
          <div>{fmt(rows[hov.r].values[hov.c])}</div>
          <div className="muted">{Math.round((rows[hov.r].values[hov.c] / Math.max(...rows[hov.r].values, 1e-9)) * 100)}% of its best month</div>
        </div>
      )}
    </div>
  );
}

/* ---- rejection flow: where every removed row went (ribbon widths are proportional to rows) */
export function RejectionFlow({ duplicates, reasons, rawRows }: { duplicates: number; reasons: { label: string; value: number }[]; rawRows: number }) {
  const [ref, w] = useWidth();
  const [hov, setHov] = useState<string | null>(null);
  const quarantined = reasons.reduce((a, b) => a + b.value, 0), removed = duplicates + quarantined;
  const narrow = w < 640, cardW = narrow ? 104 : 150, barW = 12, labelW = narrow ? 128 : 300, gap = 5, minH = 7;
  const H = narrow ? 330 : 360;
  const x0 = 0, x2 = w - labelW - barW, x1 = Math.max(cardW + 60, Math.round((x2 + cardW) / 2) - cardW / 2 - (narrow ? 8 : 20));
  // leaf column
  const lead = Math.max(...reasons.map((r) => r.value));
  const scale = (H - gap * (reasons.length - 1)) / quarantined;
  const leafH = reasons.map((r) => Math.max(minH, r.value * scale));
  const leafTotal = leafH.reduce((a, b) => a + b, 0) + gap * (reasons.length - 1);
  const mainScale = Math.min(scale, leafTotal / removed);
  const hD = duplicates * mainScale, hQ = quarantined * mainScale, hAll = hD + hQ + gap;
  const rib = (xa: number, ya0: number, ya1: number, xb: number, yb0: number, yb1: number) => {
    const xm = (xa + xb) / 2;
    return `M${xa},${ya0}C${xm},${ya0} ${xm},${yb0} ${xb},${yb0}L${xb},${yb1}C${xm},${yb1} ${xm},${ya1} ${xa},${ya1}Z`;
  };
  const totalH = Math.max(leafTotal, hAll) + 8;
  const offAll = (totalH - hAll) / 2;
  const yD = offAll, yQ = offAll + hD + gap;
  let acc = 0, cursor = 0;
  const leaves = reasons.map((r, i) => {
    const y0 = cursor, h = leafH[i]; cursor += h + gap;
    const sy0 = yQ + (acc / quarantined) * hQ, sy1 = yQ + ((acc + r.value) / quarantined) * hQ; acc += r.value;
    return { ...r, y0, h, sy0, sy1 };
  });
  const dim = (id: string) => (hov && hov !== id ? 0.2 : 1);
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={totalH} role="img" aria-label="Where the removed rows went" onPointerLeave={() => setHov(null)}>
        {/* removed -> duplicates, quarantined */}
        <path d={rib(x0 + cardW, offAll, offAll + hD, x1, yD, yD + hD)} className="rib" fill="var(--neutral)" opacity={dim("dup") * 0.45} />
        <path d={rib(x0 + cardW, offAll + hD + gap, offAll + hD + gap + hQ, x1, yQ, yQ + hQ)} className="rib" fill="var(--s2)" opacity={dim("q") * 0.45} />
        {leaves.map((l) => (
          <path key={l.label} d={rib(x1 + cardW, l.sy0, l.sy1, x2, l.y0, l.y0 + l.h)} className="rib" fill="var(--s2)" opacity={dim(l.label) * 0.5}
                onPointerEnter={() => setHov(l.label)} />
        ))}
        {/* cards */}
        <g onPointerEnter={() => setHov(null)}>
          <rect x={x0} y={offAll} width={cardW} height={hD + hQ + gap} rx="6" fill="var(--line)" />
          <text className="ftext" x={x0 + 12} y={offAll + 22}>{removed.toLocaleString("en-US")}</text>
          <text className="fsub" x={x0 + 12} y={offAll + 40}>rows removed</text>
          <text className="fsub" x={x0 + 12} y={offAll + 56}>{((100 * removed) / rawRows).toFixed(1)}% of raw</text>
        </g>
        <g onPointerEnter={() => setHov("dup")}>
          <rect x={x1} y={yD} width={cardW} height={hD} rx="6" fill="var(--neutral)" opacity={dim("dup")} />
          <text className="ftext dark" x={x1 + 12} y={yD + 22}>{duplicates.toLocaleString("en-US")}</text>
          <text className="fsub dark" x={x1 + 12} y={yD + 40}>exact duplicates</text>
        </g>
        <g onPointerEnter={() => setHov("q")}>
          <rect x={x1} y={yQ} width={cardW} height={hQ} rx="6" fill="var(--s2)" opacity={dim("q")} />
          <text className="ftext dark" x={x1 + 12} y={yQ + 22}>{quarantined.toLocaleString("en-US")}</text>
          <text className="fsub dark" x={x1 + 12} y={yQ + 40}>quarantined</text>
          <text className="fsub dark" x={x1 + 12} y={yQ + 56}>with a reason code</text>
        </g>
        {leaves.map((l) => (
          <g key={l.label} onPointerEnter={() => setHov(l.label)} opacity={dim(l.label)}>
            <rect x={x2} y={l.y0} width={barW} height={l.h} rx="3" fill="var(--s2)" />
            <text className="flabel" x={x2 + barW + 10} y={l.y0 + l.h / 2 + 4.5}>
              <tspan className="fval">{l.value.toLocaleString("en-US")}</tspan><tspan dx="8">{narrow ? l.label.slice(0, 16) : l.label}</tspan>
            </text>
          </g>
        ))}
      </svg>
      {hov && hov !== "dup" && hov !== "q" && (
        <div className="tip" style={{ top: 8, right: 8 }}><b>{hov}</b><div>{leaves.find((l) => l.label === hov)?.value.toLocaleString("en-US")} rows · {((100 * (leaves.find((l) => l.label === hov)?.value ?? 0)) / lead * (lead / quarantined)).toFixed(1)}% of quarantined</div></div>
      )}
    </div>
  );
}

/* ---- calendar of daily revenue: one dot per day, ringed in orange when flagged unusual */
export function CalendarDots({ days, fmt, dayLabel }: { days: { d: string; revenue: number; flag: boolean }[]; fmt: (n: number) => string; dayLabel: (d: string) => string }) {
  const [ref, w] = useWidth();
  const [hov, setHov] = useState<number | null>(null);
  const dow = (d: string) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday first
  const offset = dow(days[0].d), weeks = Math.ceil((days.length + offset) / 7), left = 34;
  const cell = Math.max(10, Math.min(15, Math.floor((w - left) / weeks))), width = left + weeks * cell;
  const sorted = [...days.map((d) => d.revenue)].sort((a, b) => a - b);
  const q = [0.2, 0.4, 0.6, 0.8].map((p) => sorted[Math.floor(p * sorted.length)]);
  const level = (v: number) => q.filter((t) => v >= t).length; // 0..4
  const pos = (i: number) => ({ col: Math.floor((i + offset) / 7), row: (i + offset) % 7 });
  const months: { col: number; label: string }[] = [];
  days.forEach((d, i) => { if (d.d.endsWith("-01") || i === 0) { const { col } = pos(i); if (!months.length || col - months[months.length - 1].col >= 3) months.push({ col, label: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+d.d.slice(5, 7) - 1] + (d.d.slice(5, 7) === "01" ? " " + d.d.slice(2, 4) : "") }); } });
  const H = 7 * cell + 22;
  return (
    <div ref={ref}>
      <div className="calscroll chart">
        <svg width={width} height={H} role="img" aria-label="Daily revenue calendar" onPointerLeave={() => setHov(null)}>
          {["Mon", "Wed", "Fri"].map((l, k) => <text key={l} className="axis" x={0} y={22 + k * 2 * cell + cell * 0.7}>{l}</text>)}
          {months.map((m) => <text key={m.col + m.label} className="axis" x={left + m.col * cell} y={10}>{m.label}</text>)}
          {days.map((d, i) => {
            const { col, row } = pos(i), cx = left + col * cell + cell / 2, cy = 18 + row * cell + cell / 2, r = cell * 0.38;
            return <circle key={d.d} cx={cx} cy={cy} r={d.flag ? r * 1.12 : r} fill={`var(--c${level(d.revenue) + 1})`}
                           stroke={d.flag ? "var(--s2)" : "none"} strokeWidth={d.flag ? 2 : 0} onPointerEnter={() => setHov(i)} />;
          })}
        </svg>
        {hov != null && (() => { const { col, row } = pos(hov); return (
          <div className="tip" style={{ left: Math.min(width - 170, Math.max(0, left + col * cell - 60)), top: 18 + row * cell + cell + 4 }}>
            <b>{dayLabel(days[hov].d)}</b><div>{fmt(days[hov].revenue)}</div>{days[hov].flag && <div className="flag">Unusual day</div>}
          </div>); })()}
      </div>
      <div className="calkey">
        <span className="muted">Lower</span>{[1, 2, 3, 4, 5].map((n) => <i key={n} className="dotkey" style={{ background: `var(--c${n})` }} />)}<span className="muted">Higher</span>
        <i className="dotkey ring2" /><span className="muted">Unusual day</span>
      </div>
    </div>
  );
}
