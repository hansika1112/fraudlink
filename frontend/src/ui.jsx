import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

const qs = (p = {}) => { const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== "" && v != null)).toString(); return s ? "?" + s : ""; };
async function j(r) {
  if (!r.ok) {
    let m = r.statusText;
    try { const b = await r.json(); m = b.error?.message || (Array.isArray(b.detail) ? b.detail.map((d) => `${d.loc?.slice(-1)}: ${d.msg}`).join("; ") : b.detail) || m; } catch {}
    throw new Error(m);
  }
  return r.json();
}
export const api = {
  get: (p, params) => fetch("/api" + p + qs(params)).then(j),
  post: (p, body, params) => fetch("/api" + p + qs(params), { method: "POST", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }).then(j),
  upload: (file) => { const f = new FormData(); f.append("file", file); return fetch("/api/transactions/import", { method: "POST", body: f }).then(j); },
};
export const endOfDay = (d) => (d ? d + "T23:59:59Z" : "");
export const short = (a, n = 8) => (a && a.length > 2 * n + 2 ? `${a.slice(0, n)}…${a.slice(-4)}` : a);
export const RISK = { high: "#f87171", medium: "#fbbf24", low: "#38bdf8", unclustered: "#64748b" };

export function useLoad(fn, deps) {
  const [s, set] = useState({ data: null, err: null, loading: true });
  const run = useCallback(() => { set((p) => ({ ...p, loading: true, err: null })); fn().then((data) => set({ data, err: null, loading: false })).catch((e) => set({ data: null, err: e.message, loading: false })); }, deps); // eslint-disable-line
  useEffect(run, [run]);
  return { ...s, reload: run };
}
export const Card = ({ title, action, children, className = "" }) => (
  <section className={`bg-navy-900 border border-navy-700 rounded-lg p-4 ${className}`}>
    {(title || action) && <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-slate-100">{title}</h2>{action}</div>}
    {children}
  </section>
);
export const Stat = ({ label, value, icon: I, tone = "#38bdf8" }) => (
  <div className="bg-navy-900 border border-navy-700 rounded-lg p-4 flex items-center gap-3" style={{ borderLeft: `3px solid ${tone}` }}>
    {I && <span className="rounded-md bg-navy-800 p-2 shrink-0"><I size={20} style={{ color: tone }} /></span>}
    <div><div className="text-2xl font-semibold text-slate-50 tabular-nums">{value ?? "–"}</div><div className="text-sm text-slate-400">{label}</div></div>
  </div>
);
export const Btn = ({ kind = "primary", className = "", ...p }) => (
  <button {...p} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 transition-colors ${kind === "primary" ? "bg-cyanx-500 hover:bg-cyanx-400 text-navy-950" : "bg-navy-800 hover:bg-navy-700 border border-navy-600 text-slate-200"} ${className}`} />
);
export const LinkBtn = ({ className = "", ...p }) => <a {...p} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-navy-800 hover:bg-navy-700 border border-navy-600 text-slate-200 ${className}`} />;
export const Badge = ({ level }) => (
  <span className="inline-flex items-center gap-1.5 text-xs rounded-full px-2 py-0.5 border" style={{ borderColor: RISK[level] || RISK.unclustered, color: RISK[level] || RISK.unclustered }}>
    <span className="w-1.5 h-1.5 rounded-full" style={{ background: RISK[level] || RISK.unclustered }} />{level}
  </span>
);
export const Skeleton = ({ h = 14, className = "" }) => <div className={`animate-pulse rounded bg-navy-800 ${className}`} style={{ height: h }} />;
export const Spinner = () => <div className="space-y-2 py-2" role="status" aria-label="Loading"><Skeleton className="w-1/3" /><Skeleton /><Skeleton className="w-5/6" /><Skeleton className="w-2/3" /></div>;
export const ScoreBar = ({ value, level }) => <div className="h-1.5 rounded bg-navy-800 overflow-hidden"><div className="h-full" style={{ width: `${Math.min(100, value)}%`, background: RISK[level] }} /></div>;
export const toast = (msg, kind = "ok") => window.dispatchEvent(new CustomEvent("fl-toast", { detail: { msg, kind, id: Math.random() } }));
export function Toaster() {
  const [items, set] = useState([]);
  useEffect(() => { const h = (e) => { const t = e.detail; set((x) => [...x, t]); setTimeout(() => set((x) => x.filter((y) => y.id !== t.id)), 3500); }; window.addEventListener("fl-toast", h); return () => window.removeEventListener("fl-toast", h); }, []);
  return <div aria-live="polite" className="fixed bottom-4 right-4 z-50 space-y-2">{items.map((t) => <div key={t.id} className={`rounded-md border px-3 py-2 text-sm shadow-lg bg-navy-800 ${t.kind === "err" ? "border-red-400/50 text-red-200" : "border-cyanx-400/50 text-slate-100"}`}>{t.msg}</div>)}</div>;
}
export const ErrorBox = ({ msg, onRetry }) => (
  <div role="alert" className="flex items-start gap-3 border border-red-400/40 bg-red-400/10 text-red-200 rounded-md p-3 text-sm">
    <AlertTriangle size={18} className="shrink-0 mt-0.5" /><div className="flex-1">{msg}</div>{onRetry && <button className="underline" onClick={onRetry}>Retry</button>}
  </div>
);
export const Empty = ({ title, hint, children }) => (
  <div className="text-center py-10 text-slate-400"><div className="text-slate-200 font-medium mb-1">{title}</div><div className="text-sm mb-4">{hint}</div>{children}</div>
);
export const Mono = ({ children, ...p }) => <span {...p} className={`font-mono text-xs break-all ${p.className || ""}`}>{children}</span>;
export const Field = ({ label, children, error }) => (<div><label>{label}</label>{children}{error && <p className="text-xs text-red-300 mt-1">{error}</p>}</div>);
