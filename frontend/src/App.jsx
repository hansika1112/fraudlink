import { useEffect, useRef, useState } from "react";
import { Toaster } from "./ui.jsx";
import { BarChart3, FileText, Menu, Network, Search, Settings as Cog, ShieldAlert, Table2, Upload, Wallet, Waypoints } from "lucide-react";
import { Clusters, GraphPage, ImportPage, Overview, Reports, ReportWallet, Settings, Transactions } from "./pages.jsx";

const NAV = [["overview", "Overview", BarChart3], ["report", "Report Wallet", Wallet], ["tx", "Transaction Explorer", Table2], ["graph", "Network Graph", Network], ["clusters", "Cluster Analysis", Waypoints], ["reports", "Investigation Reports", FileText], ["import", "Data Import", Upload], ["settings", "Settings & Methodology", Cog]];

export default function App() {
  const [page, setPage] = useState("overview"), [open, setOpen] = useState(false), [q, setQ] = useState(""), [sel, setSel] = useState(null), [draft, setDraft] = useState("");
  const go = (p) => { setPage(p); setOpen(false); };
  const openCluster = (id) => { setSel(id); go("clusters"); };
  const search = (e) => { e.preventDefault(); const v = draft.trim(); setQ(v); setSel(null); go("clusters"); };
  const sref = useRef();
  useEffect(() => { const h = (e) => { if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { e.preventDefault(); sref.current?.focus(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  const title = NAV.find((n) => n[0] === page)[1];
  return (
    <div className="min-h-screen lg:flex">
      <aside className={`${open ? "block" : "hidden"} lg:block lg:w-64 shrink-0 bg-navy-900 border-r border-navy-700 lg:sticky lg:top-0 lg:h-screen lg:overflow-auto`}>
        <div className="flex items-center gap-2 px-4 py-5 text-slate-50 font-semibold"><ShieldAlert className="text-cyanx-400" />FraudLink</div>
        <nav className="px-2 space-y-1" aria-label="Main">{NAV.map(([id, label, I]) => <button key={id} onClick={() => go(id)} aria-current={page === id ? "page" : undefined} className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-left ${page === id ? "bg-navy-700 text-white border-l-2 border-cyanx-400" : "text-slate-400 hover:bg-navy-800 hover:text-slate-100 border-l-2 border-transparent"}`}><I size={17} />{label}</button>)}</nav>
        <p className="px-4 py-4 text-xs text-slate-500">Scores are investigative leads, not proof of wrongdoing. Demo data is synthetic.</p>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-20 backdrop-blur flex items-center gap-3 px-4 py-3 border-b border-navy-700 bg-navy-900/80">
          <button className="lg:hidden" aria-label="Toggle navigation" onClick={() => setOpen(!open)}><Menu /></button>
          <h1 className="font-semibold text-slate-50 mr-auto">{title}</h1>
          <form onSubmit={search} className="relative w-full max-w-xs"><Search size={15} className="absolute left-3 top-3 text-slate-500" /><input ref={sref} aria-label="Search wallet address or cluster ID" className="!pl-9" placeholder="Search wallet or cluster ID  (press /)" value={draft} onChange={(e) => setDraft(e.target.value)} /></form>
        </header>
        <main className="p-4 lg:p-6">
          {page === "overview" && <Overview go={go} openCluster={openCluster} />}
          {page === "report" && <ReportWallet />}
          {page === "tx" && <Transactions />}
          {page === "graph" && <GraphPage openCluster={openCluster} />}
          {page === "clusters" && <Clusters query={q} setQuery={setQ} selected={sel} setSelected={setSel} />}
          {page === "reports" && <Reports />}
          {page === "import" && <ImportPage />}
          {page === "settings" && <Settings />}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
