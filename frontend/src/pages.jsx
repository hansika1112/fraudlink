import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import GraphView from "./graphview.jsx";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Copy, Trash2, Activity, AlertOctagon, ArrowRightLeft, Database, FileDown, FileText, Network, Play, Printer, Upload, Wallet } from "lucide-react";
import { Badge, Btn, Card, Empty, ErrorBox, Field, LinkBtn, Mono, RISK, ScoreBar, Spinner, Stat, api, endOfDay, short, toast, useLoad } from "./ui.jsx";

const tip = { contentStyle: { background: "#0c1730", border: "1px solid #1d3158", color: "#e2e8f0" } };

/* ---------- Overview ---------- */
export function Overview({ go, openCluster }) {
  const st = useLoad(() => api.get("/stats"), []);
  const cl = useLoad(() => api.get("/clusters"), []);
  const [busy, setBusy] = useState(""); const [msg, setMsg] = useState(null);
  const act = async (k, fn, ok) => { setBusy(k); setMsg(null); try { const r = await fn(); toast(typeof ok === "function" ? ok(r) : ok); st.reload(); cl.reload(); } catch (e) { setMsg(e.message); } setBusy(""); };
  if (st.loading) return <Spinner />;
  if (st.err) return <ErrorBox msg={st.err} onRetry={st.reload} />;
  const s = st.data, pie = Object.entries(s.risk_distribution).map(([name, value]) => ({ name, value }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Btn kind="ghost" disabled={!!busy} onClick={() => act("demo", () => api.post("/demo/load"), "Synthetic demo data loaded")}><Database size={16} />{busy === "demo" ? "Loading…" : "Load synthetic demo data"}</Btn>
        <Btn disabled={!!busy || !s.transactions} onClick={() => act("run", () => api.post("/clusters/analyze"), (r) => `Analysis complete: ${r.clusters} clusters`)}><Play size={16} />{busy === "run" ? "Analysing…" : "Run cluster analysis"}</Btn>
        <Btn kind="ghost" disabled={!!busy || !s.transactions} onClick={() => window.confirm("Delete all transactions, reports and clusters?") && act("reset", () => api.post("/reset"), "All data cleared")}><Trash2 size={16} />Clear all data</Btn>
      </div>
      {msg && <ErrorBox msg={msg} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Wallet} tone="#fbbf24" label="Reported wallets" value={s.reported_wallets} />
        <Stat icon={Network} label="Detected clusters" value={s.clusters} />
        <Stat icon={AlertOctagon} tone="#f87171" label="High-priority clusters" value={s.high_priority} />
        <Stat icon={ArrowRightLeft} label="Transactions analysed" value={s.transactions} />
      </div>
      {cl.data?.[0] && (() => { const t = cl.data[0]; return (
        <Card title="Start here: highest-priority lead" action={<Btn kind="ghost" onClick={() => openCluster(t.cluster_id)}>Open cluster</Btn>}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"><Mono className="text-base text-slate-50">{t.cluster_id}</Mono><Badge level={t.risk_level} /><span>Score <b>{t.score}</b>/100</span><span>{t.size} wallets</span><span>{t.reported_count} reported</span><span>Evidence: {t.evidence_strength}</span></div>
          <p className="text-xs text-slate-500 mt-2">Ranked by transparent signals, not proof. Review the evidence before acting.</p>
        </Card>); })()}
      {!s.clusters ? (
        <Card title="Get started"><ol className="grid sm:grid-cols-3 gap-3 text-sm">
          {[["Add data", "Load the synthetic demo above, or import your own CSV."], ["Run the analysis", "Group wallets into clusters and score each one."], ["Review the leads", "Open the top cluster and read its evidence."]].map(([t, d], i) => <li key={t} className="rounded-md border border-navy-700 p-3"><div className="font-medium text-slate-100">{i + 1}. {t}</div><p className="text-slate-400 mt-1">{d}</p></li>)}
        </ol><div className="mt-3"><Btn kind="ghost" onClick={() => go("import")}><Upload size={16} />Import a CSV</Btn></div></Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Risk level distribution">
            <ResponsiveContainer width="100%" height={240}><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} stroke="#0c1730">{pie.map((p) => <Cell key={p.name} fill={RISK[p.name]} />)}</Pie><Tooltip {...tip} /><Legend /></PieChart></ResponsiveContainer>
          </Card>
          <Card title="Cluster priority scores">
            <ResponsiveContainer width="100%" height={240}><BarChart data={(cl.data || []).slice(0, 10)}><CartesianGrid stroke="#1d3158" strokeDasharray="3 3" /><XAxis dataKey="cluster_id" stroke="#94a3b8" fontSize={11} /><YAxis stroke="#94a3b8" domain={[0, 100]} /><Tooltip {...tip} /><Bar dataKey="score" radius={[3, 3, 0, 0]}>{(cl.data || []).slice(0, 10).map((c) => <Cell key={c.cluster_id} fill={RISK[c.risk_level]} />)}</Bar></BarChart></ResponsiveContainer>
          </Card>
        </div>
      )}
      <Card title="Recent investigation activity">
        {s.recent_activity.length === 0 ? <p className="text-sm text-slate-400">No activity recorded yet.</p> :
          <ul className="text-sm divide-y divide-navy-800">{s.recent_activity.map((a, i) => <li key={i} className="py-2 flex gap-3"><Activity size={16} className="text-cyanx-400 mt-0.5" /><span className="flex-1">{a.event}</span><span className="text-slate-500">{a.created_at}</span></li>)}</ul>}
      </Card>
    </div>
  );
}

/* ---------- Report wallet ---------- */
const RX = { ethereum: /^0x[0-9a-fA-F]{40}$/, bitcoin: /^(bc1[0-9a-z]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/ };
const CATS = ["Investment scam", "Phishing", "Romance scam", "Ransomware", "Impersonation", "Other"];
export function ReportWallet() {
  const blank = { address: "", chain: "ethereum", report_date: new Date().toISOString().slice(0, 10), category: CATS[0], tx_hash: "", notes: "" };
  const [f, setF] = useState(blank), [errs, setErrs] = useState({}), [srv, setSrv] = useState(null), [ok, setOk] = useState(null), [busy, setBusy] = useState(false);
  const list = useLoad(() => api.get("/wallets"), []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setSrv(null); setOk(null);
    const v = {};
    if (!RX[f.chain].test(f.address.trim())) v.address = `Not a valid ${f.chain} address`;
    if (!f.report_date) v.report_date = "Required";
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try { const r = await api.post("/wallets", { ...f, address: f.address.trim(), tx_hash: f.tx_hash || null, notes: f.notes || null }); setOk(`Recorded ${short(r.address, 10)}`); toast("Wallet report saved"); setF(blank); list.reload(); } catch (x) { setSrv(x.message); }
    setBusy(false);
  };
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Report a suspicious wallet">
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Wallet address" error={errs.address}><input value={f.address} onChange={set("address")} placeholder="0x…" className="font-mono" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Blockchain"><select value={f.chain} onChange={set("chain")}><option>ethereum</option><option>bitcoin</option></select></Field>
            <Field label="Report date" error={errs.report_date}><input type="date" value={f.report_date} onChange={set("report_date")} /></Field>
          </div>
          <Field label="Suspected fraud category"><select value={f.category} onChange={set("category")}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Transaction hash (optional)"><input value={f.tx_hash} onChange={set("tx_hash")} className="font-mono" /></Field>
          <Field label="Investigator notes"><textarea rows={3} maxLength={1000} value={f.notes} onChange={set("notes")} placeholder="Avoid victim names, contact details or account numbers." /></Field>
          {srv && <ErrorBox msg={srv} />}{ok && <p className="text-sm text-emerald-300" role="status">{ok}</p>}
          <Btn disabled={busy}>{busy ? "Saving…" : "Save report"}</Btn>
        </form>
      </Card>
      <Card title="Reported wallets">
        {list.loading ? <Spinner /> : list.err ? <ErrorBox msg={list.err} onRetry={list.reload} /> : !list.data.length ? <Empty title="No reports yet" hint="Reported wallets appear here and feed the cluster score." /> :
          <div className="overflow-auto max-h-[28rem]"><table className="w-full text-sm"><thead><tr><th>Address</th><th>Chain</th><th>Date</th><th>Category</th></tr></thead><tbody>{list.data.map((w) => <tr key={w.id}><td><Mono>{short(w.address, 10)}</Mono></td><td>{w.chain}</td><td>{w.report_date}</td><td>{w.category}</td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

/* ---------- Transactions ---------- */
export function Transactions() {
  const [f, setF] = useState({ address: "", chain: "", min_amount: "", date_from: "", date_to: "" }), [page, setPage] = useState(1);
  const d = useLoad(() => api.get("/transactions", { ...f, date_to: endOfDay(f.date_to), page, page_size: 25 }), [JSON.stringify(f), page]);
  const set = (k) => (e) => { setPage(1); setF({ ...f, [k]: e.target.value }); };
  const pages = d.data ? Math.max(1, Math.ceil(d.data.total / 25)) : 1;
  return (
    <div className="space-y-4">
      <Card><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Wallet address"><input value={f.address} onChange={set("address")} className="font-mono" /></Field>
        <Field label="Network"><select value={f.chain} onChange={set("chain")}><option value="">All</option><option>ethereum</option><option>bitcoin</option></select></Field>
        <Field label="Min amount"><input type="number" min="0" value={f.min_amount} onChange={set("min_amount")} /></Field>
        <Field label="From"><input type="date" value={f.date_from} onChange={set("date_from")} /></Field>
        <Field label="To"><input type="date" value={f.date_to} onChange={set("date_to")} /></Field>
      </div></Card>
      <Card title={d.data ? `${d.data.total} transactions` : "Transactions"}>
        {d.loading ? <Spinner /> : d.err ? <ErrorBox msg={d.err} onRetry={d.reload} /> : !d.data.items.length ? <Empty title="No transactions match" hint="Adjust the filters or import data on the Data Import page." /> : <>
          <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Hash</th><th>Time (UTC)</th><th>From</th><th>To</th><th>Amount</th><th>Chain</th></tr></thead><tbody>
            {d.data.items.map((t) => <tr key={t.tx_hash + t.chain}><td><Mono>{short(t.tx_hash, 6)}</Mono>{t.synthetic ? <span className="ml-2 text-[10px] text-amber-300 border border-amber-300/40 rounded px-1">synthetic</span> : null}</td><td className="whitespace-nowrap">{t.ts.slice(0, 16).replace("T", " ")}</td>
              <td><button className="hover:underline" onClick={() => { setPage(1); setF({ ...f, address: t.sender }); }}><Mono>{short(t.sender)}</Mono></button></td><td><button className="hover:underline" onClick={() => { setPage(1); setF({ ...f, address: t.receiver }); }}><Mono>{short(t.receiver)}</Mono></button></td><td>{t.amount}</td><td>{t.chain}</td></tr>)}
          </tbody></table></div>
          <div className="flex items-center gap-3 mt-3 text-sm"><Btn kind="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn><span>Page {page} of {pages}</span><Btn kind="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Btn></div></>}
      </Card>
    </div>
  );
}

/* ---------- Network graph ---------- */
export function GraphPage({ openCluster }) {
  const [f, setF] = useState({ risk_level: "", chain: "", min_amount: "", date_from: "", date_to: "" });
  const d = useLoad(() => api.get("/graph", { ...f, date_to: endOfDay(f.date_to) }), [JSON.stringify(f)]);
  const box = useRef(), cy = useRef(); const [sel, setSel] = useState(null), [nb, setNb] = useState(null), [hover, setHover] = useState(""), [find, setFind] = useState(""), [focus, setFocus] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  useEffect(() => {
    if (!d.data || !box.current) return;
    cy.current?.destroy();
    const els = [
      ...d.data.nodes.map((n) => ({ data: { id: n.id, cid: n.cluster_id || "", label: n.label || short(n.id, 4), size: 12 + Math.min(34, Math.sqrt(n.activity) * 6), color: RISK[n.risk_level] || RISK.unclustered, shape: n.label ? "diamond" : "ellipse" } })),
      ...d.data.edges.map((e, i) => ({ data: { id: "e" + i, source: e.source, target: e.target, w: 1 + Math.min(4, Math.log10(1 + e.amount)) } })),
    ];
    cy.current = cytoscape({ container: box.current, elements: els, wheelSensitivity: 0.3,
      style: [{ selector: "node", style: { width: "data(size)", height: "data(size)", "background-color": "data(color)", shape: "data(shape)", label: "data(label)", color: "#94a3b8", "font-size": 8, "text-valign": "bottom", "text-margin-y": 3 } },
        { selector: "edge", style: { width: "data(w)", "line-color": "#2b4474", "target-arrow-color": "#2b4474", "target-arrow-shape": "triangle", "curve-style": "bezier", "arrow-scale": 0.7 } },
        { selector: ":selected", style: { "border-width": 3, "border-color": "#e2e8f0" } }],
      layout: { name: "cose", animate: false, nodeRepulsion: 9000, idealEdgeLength: 70 } });
    cy.current.on("tap", "node", (e) => { const id = e.target.id(); setSel(d.data.nodes.find((n) => n.id === id)); setNb(null); api.get(`/wallets/${id}/neighborhood`).then(setNb).catch(() => setNb({ transactions: [], neighbors: [] })); });
    cy.current.on("mouseover", "node", (e) => setHover(e.target.id())); cy.current.on("mouseout", "node", () => setHover(""));
    return () => cy.current?.destroy();
  }, [d.data]);
  useEffect(() => {
    const c = cy.current; if (!c) return;
    c.batch(() => { c.elements().style("opacity", 1); if (focus) { c.nodes().forEach((n) => n.style("opacity", n.data("cid") === focus ? 1 : 0.1)); c.edges().forEach((e) => e.style("opacity", e.source().data("cid") === focus && e.target().data("cid") === focus ? 1 : 0.05)); } });
  }, [focus, d.data]);
  return (
    <div className="space-y-4">
      <Card><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Risk level"><select value={f.risk_level} onChange={set("risk_level")}><option value="">All</option><option>high</option><option>medium</option><option>low</option><option>unclustered</option></select></Field>
        <Field label="Network"><select value={f.chain} onChange={set("chain")}><option value="">All</option><option>ethereum</option><option>bitcoin</option></select></Field>
        <Field label="Min amount"><input type="number" min="0" value={f.min_amount} onChange={set("min_amount")} /></Field>
        <Field label="From"><input type="date" value={f.date_from} onChange={set("date_from")} /></Field>
        <Field label="To"><input type="date" value={f.date_to} onChange={set("date_to")} /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-navy-700">
        <form className="flex gap-2 flex-1 min-w-[16rem]" onSubmit={(e) => { e.preventDefault(); const q = find.trim().toLowerCase(); const n = cy.current?.nodes().filter((x) => x.id().includes(q) || String(x.data("label")).toLowerCase().includes(q)); if (q && n && n.length) { n[0].emit("tap"); cy.current.animate({ center: { eles: n[0] }, zoom: 1.6 }, { duration: 300 }); } else toast("No matching wallet in this view", "err"); }}>
          <input aria-label="Find wallet in graph" placeholder="Find a wallet in the graph" value={find} onChange={(e) => setFind(e.target.value)} className="font-mono" /><Btn kind="ghost">Find</Btn></form>
        <div className="w-56"><label>Highlight cluster</label><select value={focus} onChange={(e) => setFocus(e.target.value)}><option value="">None</option>{[...new Set((d.data?.nodes || []).map((n) => n.cluster_id).filter(Boolean))].map((c) => <option key={c}>{c}</option>)}</select></div>
        <Btn type="button" kind="ghost" onClick={() => cy.current?.fit(undefined, 40)}>Fit view</Btn>
      </div></Card>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="Wallet network" action={<div className="flex gap-3 text-xs text-slate-400">{Object.entries(RISK).map(([k, c]) => <span key={k} className="flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />{k}</span>)}<span>◆ labelled endpoint</span></div>}>
          {d.loading ? <Spinner /> : d.err ? <ErrorBox msg={d.err} onRetry={d.reload} /> : !d.data.nodes.length ? <Empty title="No graph data" hint="Import transactions or relax the filters." /> : <><div ref={box} className="h-[520px] rounded bg-navy-950" aria-label="Wallet transaction network" /><p className="text-xs text-slate-400 mt-2 h-4 font-mono">{hover}</p></>}
        </Card>
        <Card title="Selected wallet">
          {!sel ? <p className="text-sm text-slate-400">Click a node to see its transactions and connected wallets. Node size shows activity; colour shows cluster risk.</p> : <div className="space-y-3 text-sm">
            <Mono>{sel.id}</Mono>
            <div className="flex items-center gap-2"><Badge level={sel.risk_level} />{sel.label && <span className="text-cyanx-400">{sel.label}</span>}</div>
            {sel.cluster_id && <Btn kind="ghost" onClick={() => openCluster(sel.cluster_id)}>Open {sel.cluster_id}</Btn>}
            {!nb ? <Spinner /> : <><div>{nb.neighbors.length} connected wallets · {nb.transactions.length} transactions</div>
              <div className="max-h-64 overflow-auto"><table className="w-full"><tbody>{nb.transactions.slice(0, 30).map((t) => <tr key={t.tx_hash}><td className="text-xs">{t.sender === sel.id ? "→ out" : "← in"}</td><td><Mono>{short(t.sender === sel.id ? t.receiver : t.sender, 6)}</Mono></td><td>{t.amount}</td></tr>)}</tbody></table></div></>}
          </div>}
        </Card>
      </div>
    </div>
  );
}

/* ---------- Clusters ---------- */
const List = ({ title, items, tone }) => (<div><h4 className={`font-medium mb-1 ${tone}`}>{title}</h4><ul className="list-disc pl-5 space-y-1 text-sm text-slate-300">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>);
export function Clusters({ query, setQuery, selected, setSelected }) {
  const [risk, setRisk] = useState("");
  const l = useLoad(() => api.get("/clusters", { search: query, risk_level: risk }), [query, risk]);
  const d = useLoad(() => (selected ? api.get("/clusters/" + selected) : Promise.resolve(null)), [selected]);
  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2" title="Clusters" action={<select aria-label="Risk filter" className="!w-auto" value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">All risks</option><option>high</option><option>medium</option><option>low</option></select>}>
        {query && <p className="text-xs text-slate-400 mb-2">Search: <Mono>{query}</Mono> <button className="underline ml-2" onClick={() => setQuery("")}>clear</button></p>}
        {l.loading ? <Spinner /> : l.err ? <ErrorBox msg={l.err} onRetry={l.reload} /> : !l.data.length ? <Empty title="No clusters found" hint="Run the analysis from the Overview page, or clear the search and filter." /> :
          <ul className="space-y-2">{l.data.map((c) => <li key={c.cluster_id}><button onClick={() => setSelected(c.cluster_id)} className={`w-full text-left rounded-md border p-3 ${selected === c.cluster_id ? "border-cyanx-400 bg-navy-800" : "border-navy-700 hover:bg-navy-800"}`}>
            <div className="flex justify-between items-center"><Mono className="text-sm">{c.cluster_id}</Mono><Badge level={c.risk_level} /></div>
            <div className="text-xs text-slate-400 mt-1">{c.size} wallets · {c.tx_count} tx · score {c.score} · evidence {c.evidence_strength}</div><div className="mt-2"><ScoreBar value={c.score} level={c.risk_level} /></div></button></li>)}</ul>}
      </Card>
      <div className="lg:col-span-3 space-y-4">
        {!selected ? <Card><Empty title="Select a cluster" hint="Details, evidence and next steps appear here." /></Card> : d.loading ? <Card><Spinner /></Card> : d.err ? <ErrorBox msg={d.err} /> : d.data && <>
          <Card title={`${d.data.cluster_id} · ${d.data.size} wallets`} action={<div className="flex gap-2"><LinkBtn href={`/api/reports/pdf?cluster_id=${d.data.cluster_id}`}><FileDown size={15} />PDF</LinkBtn><LinkBtn href={`/api/reports?format=csv&cluster_id=${d.data.cluster_id}`}>CSV</LinkBtn></div>}>
            <div className="flex flex-wrap items-center gap-6 mb-3"><div className="w-36"><div className="text-4xl font-semibold tabular-nums" style={{ color: RISK[d.data.risk_level] }}>{d.data.score}<span className="text-base text-slate-500">/100</span></div><div className="mt-1"><ScoreBar value={d.data.score} level={d.data.risk_level} /></div></div>
              <div className="text-sm space-y-1"><Badge level={d.data.risk_level} /><div>Evidence strength: <b>{d.data.evidence_strength}</b></div><div className="text-slate-400">Volume {d.data.volume} · {d.data.tx_count} transactions</div></div></div>
            <ResponsiveContainer width="100%" height={170}><BarChart layout="vertical" data={Object.entries(d.data.score_breakdown).map(([k, v]) => ({ k: k.replaceAll("_", " "), v }))}><XAxis type="number" stroke="#94a3b8" /><YAxis type="category" dataKey="k" width={170} stroke="#94a3b8" fontSize={11} /><Tooltip {...tip} /><Bar dataKey="v" fill="#38bdf8" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer>
          </Card>
          <Card title="Activity timeline (daily)">
            <ResponsiveContainer width="100%" height={170}><AreaChart data={d.data.timeline}><CartesianGrid stroke="#1d3158" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#94a3b8" fontSize={11} /><YAxis stroke="#94a3b8" /><Tooltip {...tip} /><Area type="monotone" dataKey="tx" name="transactions" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.25} /></AreaChart></ResponsiveContainer>
          </Card>
          <Card title="Cluster fund-flow graph" action={<span className="text-xs text-slate-400">cyan = member · red = reported · amber ◆ = labelled endpoint · grey = external</span>}>
            <GraphView sig={d.data.cluster_id} height={340}
              nodes={d.data.graph_nodes.map((n) => ({ id: n.id, label: n.label || short(n.id, 4), size: n.label ? 26 : 16, shape: n.label ? "diamond" : "ellipse", color: n.label ? "#fbbf24" : n.reported ? "#f87171" : n.member ? "#38bdf8" : "#64748b" }))}
              edges={d.data.edges.map((e) => ({ source: e.source, target: e.target, w: 1 + Math.min(4, Math.log10(1 + e.amount)) }))} />
          </Card>
          <Card title={`Wallets in cluster (${d.data.wallets.length})`}><div className="overflow-auto max-h-72"><table className="w-full text-sm"><thead><tr><th>Address</th><th>Flags</th><th>In</th><th>Out</th></tr></thead><tbody>
            {d.data.wallets.map((w) => <tr key={w.address}><td><Mono>{short(w.address, 10)}</Mono> <button aria-label="Copy address" className="text-slate-500 hover:text-cyanx-400 align-middle" onClick={() => { navigator.clipboard.writeText(w.address); toast("Address copied"); }}><Copy size={13} /></button></td>
              <td className="space-x-1">{w.reported && <span className="text-xs text-red-300 border border-red-300/40 rounded px-1">reported</span>}{w.pass_through && <span className="text-xs text-amber-300 border border-amber-300/40 rounded px-1">pass-through</span>}{w.label && <span className="text-xs text-cyanx-400 border border-cyanx-400/40 rounded px-1">{w.label}</span>}</td><td>{w.total_in}</td><td>{w.total_out}</td></tr>)}</tbody></table></div></Card>
          <Card title="Evidence"><div className="space-y-4">
            <List title="Observed facts" items={d.data.observed_facts} tone="text-emerald-300" />
            <List title="Heuristic signals" items={d.data.heuristic_signals} tone="text-amber-300" />
            <List title="Unverified hypotheses" items={d.data.unverified_hypotheses} tone="text-red-300" />
            <List title="Recommended next steps" items={d.data.next_steps} tone="text-cyanx-400" />
            <p className="text-xs text-slate-500">{d.data.disclaimer}</p></div></Card>
          <Card title="Top transactions"><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Hash</th><th>From</th><th>To</th><th>Amount</th></tr></thead><tbody>{d.data.top_transactions.map((t) => <tr key={t.tx_hash}><td><Mono>{short(t.tx_hash, 6)}</Mono></td><td><Mono>{short(t.sender)}</Mono></td><td><Mono>{short(t.receiver)}</Mono></td><td>{t.amount}</td></tr>)}</tbody></table></div></Card>
          <Card title={`Shared counterparties (${d.data.shared_counterparties.length})`}>{!d.data.shared_counterparties.length ? <p className="text-sm text-slate-400">None observed.</p> : <ul className="text-sm space-y-1">{d.data.shared_counterparties.map((s) => <li key={s.address}><Mono>{short(s.address, 10)}</Mono> <span className="text-slate-400">linked to {s.linked_members.length} cluster wallets</span></li>)}</ul>}</Card>
        </>}
      </div>
    </div>
  );
}

/* ---------- Reports ---------- */
export function Reports() {
  const l = useLoad(() => api.get("/clusters"), []);
  return (
    <div className="space-y-4">
      <Card title="Investigation report (all clusters)">
        <p className="text-sm text-slate-400 mb-3">Includes summary, evidence classes, score breakdown, supporting transaction references, data limitations and the disclaimer.</p>
        <div className="flex flex-wrap gap-2"><LinkBtn href="/api/reports/pdf"><FileDown size={16} />Download PDF</LinkBtn><LinkBtn href="/api/reports?format=csv"><FileText size={16} />Export CSV</LinkBtn><LinkBtn href="/api/reports?format=html" target="_blank" rel="noreferrer"><Printer size={16} />Printable view</LinkBtn><LinkBtn href="/api/reports?format=json">JSON</LinkBtn></div>
      </Card>
      <Card title="Per-cluster reports">
        {l.loading ? <Spinner /> : l.err ? <ErrorBox msg={l.err} onRetry={l.reload} /> : !l.data.length ? <Empty title="Nothing to report yet" hint="Run the cluster analysis first." /> :
          <table className="w-full text-sm"><thead><tr><th>Cluster</th><th>Risk</th><th>Score</th><th>Export</th></tr></thead><tbody>{l.data.map((c) => <tr key={c.cluster_id}><td><Mono>{c.cluster_id}</Mono></td><td><Badge level={c.risk_level} /></td><td>{c.score}</td><td className="space-x-3"><a className="underline" href={`/api/reports/pdf?cluster_id=${c.cluster_id}`}>PDF</a><a className="underline" href={`/api/reports?format=csv&cluster_id=${c.cluster_id}`}>CSV</a><a className="underline" target="_blank" rel="noreferrer" href={`/api/reports?format=html&cluster_id=${c.cluster_id}`}>Print</a></td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}

/* ---------- Import ---------- */
export function ImportPage() {
  const [file, setFile] = useState(null), [res, setRes] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false), [drag, setDrag] = useState(false);
  const go = async () => { setBusy(true); setErr(null); setRes(null); try { const r = await api.upload(file); setRes(r); toast(`Imported ${r.inserted} transactions`); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Import transactions (CSV)">
        <p className="text-sm text-slate-400 mb-3">Required columns: transaction_hash, timestamp, sender_address, receiver_address, amount, blockchain. Optional: transaction_fee. Maximum 5 MB.</p>
        <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files[0] || null); }}
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 mb-3 cursor-pointer text-center ${drag ? "border-cyanx-400 bg-navy-800" : "border-navy-600"}`}>
          <Upload className="text-cyanx-400" /><span className="text-slate-200">{file ? `${file.name} (${(file.size / 1024).toFixed(1)} KB)` : "Drop a CSV here, or click to choose a file"}</span>
          <input type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        <div className="flex gap-2"><Btn disabled={!file || busy} onClick={go}><Upload size={16} />{busy ? "Importing…" : "Import file"}</Btn><LinkBtn href="/api/sample-csv">Download synthetic sample CSV</LinkBtn></div>
        {err && <div className="mt-3"><ErrorBox msg={err} /></div>}
      </Card>
      <Card title="Import summary">
        {!res ? <p className="text-sm text-slate-400">The result of the last import appears here.</p> : <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Stat label="Inserted" value={res.inserted} /><Stat label="Already stored" value={res.already_in_database} /><Stat label="Duplicates in file" value={res.duplicates_in_file} /><Stat label="Malformed rows" value={res.malformed_rows} /></div>
          {res.errors.length > 0 && <div className="max-h-48 overflow-auto text-sm"><table className="w-full"><thead><tr><th>Row</th><th>Problem</th></tr></thead><tbody>{res.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.error}</td></tr>)}</tbody></table></div>}
          <p className="text-xs text-slate-500">Re-run the cluster analysis from the Overview page to include new data.</p></div>}
      </Card>
    </div>
  );
}

/* ---------- Settings & methodology ---------- */
export function Settings() {
  const [an, setAn] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setErr(null); try { setAn(await api.get("/anomalies", { top: 15 })); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <div className="space-y-4">
      <Card title="Methodology"><div className="text-sm text-slate-300 space-y-2 max-w-3xl leading-relaxed">
        <p>Wallet addresses are validated per network, then a weighted transaction graph is built (edge weight = 1 + ln(1 + total amount), which damps very large transfers). Communities are detected with the Louvain algorithm using a fixed seed so results repeat.</p>
        <p>Each cluster receives a 0–100 priority score from itemised components: reported wallets (25), supplied exchange label receiving from 2+ members (25), shared counterparties (15), rapid pass-through of funds (15), 24-hour temporal burst (10), and an unlabelled aggregation pattern (10). Medium ≥ 35; high needs a score ≥ 60 and at least one reported wallet, so unreported clusters never rank as high.</p>
        <p>Findings are separated into <b className="text-emerald-300">observed facts</b>, <b className="text-amber-300">heuristic signals</b> and <b className="text-red-300">unverified hypotheses</b>. Exchange labels come only from supplied data; nothing is inferred as an exchange.</p>
      </div></Card>
      <Card title="Limitations and disclaimer"><ul className="list-disc pl-5 text-sm text-slate-300 space-y-1"><li>Scores are investigative leads, not proof of wrongdoing, and connected wallets are not assumed to share an owner.</li><li>Only supplied transactions are analysed; Louvain is a heuristic and results depend on data coverage.</li><li>Demo records are synthetic and must never be presented as real evidence.</li><li>No external blockchain APIs are called; the application runs offline.</li></ul></Card>
      <Card title="Optional: anomaly detection" action={<Btn kind="ghost" disabled={busy} onClick={run}>{busy ? "Running…" : "Run IsolationForest"}</Btn>}>
        <p className="text-sm text-slate-400 mb-3">Flags wallets whose degree, volume and activity-span profile is unusual compared with others. Statistical outliers only: a triage aid, not an indicator of wrongdoing.</p>
        {err && <ErrorBox msg={err} />}
        {an && (!an.items.length ? <Empty title="Not enough data" hint="At least 20 transactions are needed." /> : <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Wallet</th><th>Outlier score</th><th>In</th><th>Out</th><th>Tx</th><th>Span (h)</th></tr></thead><tbody>{an.items.map((a) => <tr key={a.address}><td><Mono>{short(a.address, 8)}</Mono></td><td>{a.anomaly_score}</td><td>{a.in_degree}</td><td>{a.out_degree}</td><td>{a.tx_count}</td><td>{a.span_hours}</td></tr>)}</tbody></table></div>)}
      </Card>
      <Card title="API documentation"><a className="text-cyanx-400 underline" href="/docs" target="_blank" rel="noreferrer">Open interactive API docs (FastAPI /docs)</a></Card>
    </div>
  );
}
