import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export type Cmd = { id: string; label: string; hint: string; run: () => void };

export default function Palette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Cmd[] }) {
  const [q, setQ] = useState(""), [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const list = commands.filter((c) => (c.label + " " + c.hint).toLowerCase().includes(q.toLowerCase()));
  const go = (c?: Cmd) => { if (!c) return; onClose(); c.run(); };
  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}
           onKeyDown={(e) => {
             if (e.key === "Escape") onClose();
             else if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
             else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
             else if (e.key === "Enter") go(list[i]);
           }}>
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Jump to a page or change the theme" aria-label="Search commands" />
        <ul>
          {list.map((c, k) => (
            <li key={c.id} className={k === i ? "on" : ""} onMouseEnter={() => setI(k)} onClick={() => go(c)}><span>{c.label}</span><em>{c.hint}</em></li>
          ))}
          {list.length === 0 && <li className="none">Nothing matches "{q}"</li>}
        </ul>
      </div>
    </div>
  );
}
export function usePaletteKey(toggle: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggle(); } };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  });
}
export { useNavigate };
