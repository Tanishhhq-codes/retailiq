import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Link, MemoryRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { STATIC } from "./data";
import { BrandMark } from "./Brand";
import Home from "./pages/Home";
import { fmtInt, useMeta } from "./data";
import Overview from "./pages/Overview";
import Quality from "./pages/Quality";
import Quarantine from "./pages/Quarantine";
import Customers from "./pages/Customers";
import Insights from "./pages/Insights";
import Pipeline from "./pages/Pipeline";
import Palette, { usePaletteKey } from "./Palette";

// The static preview runs in a sandboxed frame where only "#name" hashes are kept, so routes map to #quality etc.
function HashSync() {
  const loc = useLocation(), nav = useNavigate();
  useEffect(() => { const h = loc.pathname.slice(1); if (location.hash.slice(1) !== h) history.replaceState(null, "", h ? `#${h}` : location.pathname); }, [loc.pathname]);
  useEffect(() => { const on = () => nav("/" + location.hash.slice(1)); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, [nav]);
  return null;
}
function Router({ children }: { children: ReactNode }) {
  if (!STATIC) return <BrowserRouter>{children}</BrowserRouter>;
  return <MemoryRouter initialEntries={["/" + location.hash.slice(1)]}><HashSync />{children}</MemoryRouter>;
}

const I = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const NAV = [
  { to: "/overview", label: "Overview", icon: I("M4 20V10M10 20V4M16 20v-8M22 20H2") },
  { to: "/quality", label: "Data quality", icon: I("M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5L16 9.5") },
  { to: "/quarantine", label: "Quarantine", icon: I("M4 7h16M4 12h16M4 17h10") },
  { to: "/customers", label: "Customers", icon: I("M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.9M16 4.2a3.5 3.5 0 010 6.6") },
  { to: "/insights", label: "Insights", icon: I("M3 17l5-5 4 4 8-9M15 7h5v5") },
  { to: "/pipeline", label: "Pipeline", icon: I("M5 6a2 2 0 100-4 2 2 0 000 4zM19 22a2 2 0 100-4 2 2 0 000 4zM5 6v5a4 4 0 004 4h6a4 4 0 014 4") },
];

function Shell({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const { data: meta } = useMeta();
  const [pal, setPal] = useState(false), nav = useNavigate();
  usePaletteKey(() => setPal((o) => !o));
  const commands = [
    ...NAV.map((n) => ({ id: n.to, label: n.label, hint: "Go to page", run: () => nav(n.to) })),
    { id: "home", label: "Home", hint: "Go to page", run: () => nav("/") },
    { id: "theme", label: dark ? "Switch to light mode" : "Switch to dark mode", hint: "Theme", run: () => setDark(!dark) },
  ];
  return (
    <div className="shell">
      <Palette open={pal} onClose={() => setPal(false)} commands={commands} />
      <aside className="side">
        <Link to="/" className="brand"><BrandMark size={26} />RetailIQ</Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => <NavLink key={n.to} to={n.to}>{n.icon}{n.label}</NavLink>)}
        </nav>
        <button className="searchbtn" onClick={() => setPal(true)}>Search<kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd></button>
        <div className="side-foot">
          {meta && (
            <div className="runbox">
              <b>{meta.run.run_id} · {meta.run.mode}</b>
              <span>{fmtInt(meta.run.clean_rows)} clean of {fmtInt(meta.run.raw_rows)} rows</span>
              {meta.run.ground_truth_match != null && (
                <span className={meta.run.ground_truth_match ? "ok" : "err"}>
                  {meta.run.ground_truth_match ? "✓ Matches injected defects" : "✗ Differs from injected defects"}
                </span>
              )}
            </div>
          )}
          <button className="theme" onClick={() => setDark(!dark)} aria-pressed={dark}>{dark ? "Switch to light mode" : "Switch to dark mode"}</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/overview" element={<Overview />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/quarantine" element={<Quarantine />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="*" element={<div className="notice">That page does not exist. Use the menu to pick a section.</div>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("riq-theme") === "dark"; } catch { return false; } });
  // layout effect: the theme attribute must be set before child effects read CSS variables
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("riq-theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [dark]);
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home dark={dark} onToggleTheme={() => setDark(!dark)} />} />
        <Route path="/*" element={<Shell dark={dark} setDark={setDark} />} />
      </Routes>
    </Router>
  );
}
