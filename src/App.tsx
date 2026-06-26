import { useEffect, useState, useCallback } from "react";
import {
  BarChart3, FileSpreadsheet, LogOut, RefreshCw, Settings, Shield, Video,
} from "lucide-react";
import { clearToken, getToken, setToken } from "./api";
import {
  getDashboard, getMaterials, getMaterialDetail, deleteMaterial,
  runSync, getCurrentUser, loginUser, getReports, generateReport, pushReport,
} from "./services/apiClient";
import type { User, DashboardData, MaterialMetric, DateMode } from "./types";
import { getDateRange, rangeLabel, today, weekLabel } from "./lib/date";
import { money, numberText, percent, roi } from "./lib/format";
import { TrendChart } from "./components/TrendChart";
import { PieChart } from "./components/PieChart";
import { BarChart } from "./components/BarChart";
import { AdminPanel } from "./components/AdminPanel";

// ====== Login ======
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [show, setShow] = useState(false); const [u, setU] = useState(""); const [p, setP] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await loginUser(u, p); setToken(r.token); onLogin(r.user); } catch (ex) { setErr(ex instanceof Error ? ex.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return (<main className="login-shell"><form className="login-card glass" onSubmit={submit}>
    <div className="logo-icon">🎬</div><h1>抖音视频投放管理</h1>
    <button type="button" className="btn-ghost" onClick={() => onLogin({ id: 0, username: "访客", role: "viewer" })}>直接访问（只读）</button>
    <button type="button" className="btn-text" onClick={() => setShow(v => !v)}><Shield size={16} /> 管理员登录</button>
    {show && <><label>账号 <input value={u} autoComplete="username" onChange={e => setU(e.target.value)} /></label>
    <label>密码 <input value={p} type="password" autoComplete="current-password" onChange={e => setP(e.target.value)} /></label></>}
    {err && <p className="error">{err}</p>}
    {show && <button className="btn-primary" disabled={busy} type="submit"><Shield size={16} /> {busy ? "登录中..." : "确认登录"}</button>}
  </form></main>);
}

const warmOrange = "#c7821a";

// ====== Sortable Table Header ======
function SortTh({ col, label, currentSort, currentDir, onClick }: {
  col: string; label: string; currentSort: string; currentDir: string; onClick: (c: string) => void;
}) {
  const active = currentSort === col;
  return (
    <th className="sort-header" onClick={() => onClick(col)}>
      {label}{active ? <span className="sort-arrow">{currentDir === "desc" ? "▼" : "▲"}</span> : null}
    </th>
  );
}

// ====== KPI Card ======
function KpiCard({ label, value, sub, accent, highlight, valueColor }: {
  label: string; value: string; sub?: string; accent?: boolean; highlight?: boolean; valueColor?: string;
}) {
  return (<div className={`kpi-card glass ${highlight ? "highlight" : ""}`}>
    <span className="kpi-label">{label}</span>
    <strong className={accent && !valueColor ? "kpi-accent" : ""} style={valueColor ? { color: valueColor } : {}}>{value}</strong>
    {sub && <small>{sub}</small>}
  </div>);
}

// ====== Week Picker (generate week options) ======
function WeekPicker({ selected, onChange }: { selected: string; onChange: (v: string) => void }) {
  // Generate list of Mondays for current year
  const now = new Date();
  const year = now.getFullYear();
  const weeks: { label: string; value: string }[] = [];
  // Start from first Monday of the year
  const jan1 = new Date(year, 0, 1);
  const firstMonday = new Date(jan1);
  firstMonday.setDate(jan1.getDate() - (jan1.getDay() || 7) + 1);
  if (firstMonday > jan1) firstMonday.setDate(firstMonday.getDate() - 7);

  let d = new Date(firstMonday);
  while (d.getFullYear() <= year && d <= new Date()) {
    const sunday = new Date(d); sunday.setDate(d.getDate() + 6);
    const v = d.toISOString().slice(0, 10);
    weeks.push({ label: `${d.toISOString().slice(5,10)} - ${sunday.toISOString().slice(5,10)}`, value: v });
    d.setDate(d.getDate() + 7);
  }
  weeks.reverse(); // newest first

  return (
    <select className="date-input" style={{ width: 180 }} value={selected} onChange={e => onChange(e.target.value)}>
      {weeks.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
    </select>
  );
}

// ====== App ======
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"dashboard" | "materials" | "products" | "plans" | "reports" | "admin">("dashboard");
  const [data, setData] = useState<DashboardData | null>(null);
  const [materials, setMaterials] = useState<MaterialMetric[]>([]);
  const [materialTotal, setMaterialTotal] = useState(0);
  const [materialPage, setMaterialPage] = useState(1);
  const [matSort, setMatSort] = useState("spend");
  const [matSortDir, setMatSortDir] = useState<"desc"|"asc">("desc");
  const [videoPaths, setVideoPaths] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ material: MaterialMetric; trends: MaterialMetric[] } | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("all");
  const [selectedDate, setSelectedDate] = useState(today());
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState("");
  const [search, setSearch] = useState(""); const [reportLogs, setReportLogs] = useState<any[]>([]);

  const isAdmin = user?.role === "admin";
  const range = dateMode === "all" ? null : dateMode === "custom" ? { from: fromDate, to: toDate } : getDateRange(selectedDate, dateMode as "day"|"week"|"month");
  const summary = data?.summary; const acne = data?.acne; const video = data?.video;
  const pageSize = 15; const totalPages = Math.max(1, Math.ceil(materialTotal / pageSize));

  const loadData = useCallback(async () => {
    try {
      if (dateMode === "all") setData(await getDashboard());
      else {
        const r = dateMode === "custom" ? { from: fromDate, to: toDate } : getDateRange(selectedDate, dateMode as "day"|"week"|"month");
        setData(await getDashboard(r.from, r.to));
      }
      setError("");
    } catch (ex) { setError(ex instanceof Error ? ex.message : "加载失败"); }
  }, [dateMode, fromDate, toDate, selectedDate]);

  const loadMaterials = useCallback(async () => {
    try {
      const r = await getMaterials({ search: search || undefined, sortBy: matSort, sortDir: matSortDir, limit: pageSize, offset: (materialPage - 1) * pageSize });
      setMaterials(r.items); setMaterialTotal(r.total);
    } catch { /* ignore */ }
  }, [search, materialPage, matSort, matSortDir]);

  function changeSort(col: string) {
    if (matSort === col) setMatSortDir(d => d === "desc" ? "asc" : "desc");
    else { setMatSort(col); setMatSortDir("desc"); }
    setMaterialPage(1);
  }

  async function openDetail(id: number) {
    try { setDetail(await getMaterialDetail(id)); } catch { /* */ }
    try {
      const mn = materials.find(m => m.id === id)?.material_name || "";
      const r = await fetch(`/api/video/find?${new URLSearchParams({ name: mn })}`).then(r => r.json());
      setVideoPaths(r.found ? r.paths : []);
    } catch { setVideoPaths([]); }
  }

  useEffect(() => { if (!getToken()) return; getCurrentUser().then(r => setUser(r.user)).catch(() => clearToken()); }, []);
  useEffect(() => { if (user) { loadData(); loadMaterials(); } }, [user, loadData, loadMaterials]);
  useEffect(() => { if (!user) return; const t = setInterval(() => { loadData(); loadMaterials(); }, 30 * 60 * 1000); return () => clearInterval(t); }, [user, loadData, loadMaterials]);

  async function doSync() {
    setBusy("sync"); setNotice(""); setError("");
    try { const r = await runSync(); setNotice(`同步完成: ${r.files.length} 文件, ${r.totalRows} 行`); await loadData(); await loadMaterials(); } catch (ex) { setError(ex instanceof Error ? ex.message : "同步失败"); } finally { setBusy(""); }
  }
  async function loadReports() { try { setReportLogs((await getReports()).items); } catch { /* */ } }

  const viewTitle = () => ({ dashboard: "视频投放数据", materials: "视频素材", products: "商品分析", plans: "投放计划", reports: "数据报告", admin: "系统管理" }[view] || view);

  if (!user) return <Login onLogin={setUser} />;

  return (<div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="logo-icon">🎬</div><div><strong>中草集</strong><span>抖音投放管理</span></div></div>
      <nav>
        <button className={`nav-btn ${view==="dashboard"?"active":""}`} onClick={() => setView("dashboard")}><BarChart3 size={18} /> 视频投放数据</button>
        <button className={`nav-btn ${view==="materials"?"active":""}`} onClick={() => setView("materials")}><FileSpreadsheet size={18} /> 视频素材</button>
        <button className={`nav-btn ${view==="products"?"active":""}`} onClick={() => setView("products")}>📦 商品分析</button>
        <button className={`nav-btn ${view==="plans"?"active":""}`} onClick={() => setView("plans")}>📋 投放计划</button>
        <button className={`nav-btn ${view==="reports"?"active":""}`} onClick={() => { setView("reports"); loadReports(); }}>📈 数据报告</button>
        {isAdmin && <button className={`nav-btn ${view==="admin"?"active":""}`} onClick={() => setView("admin")}><Settings size={18} /> 系统管理</button>}
      </nav>
      {isAdmin && <button className="btn-ghost sync-btn" disabled={busy==="sync"} onClick={doSync}><RefreshCw size={16} className={busy==="sync"?"spin":""} /> 同步数据</button>}
      <div className="user-row"><div className="avatar">{(user.username||"?")[0].toUpperCase()}</div><div><span>{user.username}</span><small>{isAdmin?"管理员":"只读"}</small></div>{isAdmin && <button className="btn-icon" title="退出" onClick={()=>{clearToken();setUser(null);}}><LogOut size={16}/></button>}</div>
    </aside>

    <main className="content">
      {/* ====== Topbar with Week Picker ====== */}
      <header className="topbar glass">
        <h2 style={{ fontSize: 32, fontWeight: 900 }}>{viewTitle()}</h2>
        <div className="filters">
          <div className="segmented">
            {(["all","day","week","month","custom"] as DateMode[]).map(m => (
              <button key={m} className={dateMode===m?"active":""} onClick={() => setDateMode(m)}>{{all:"全部",day:"日",week:"周",month:"月",custom:"自定义"}[m]}</button>
            ))}
          </div>
          {dateMode === "all" ? null : dateMode === "custom" ? (
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input className="date-input" type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} />
              <span style={{color:"var(--text-muted)",fontSize:13,fontWeight:700}}>至</span>
              <input className="date-input" type="date" value={toDate} onChange={e=>setToDate(e.target.value)} />
            </div>
          ) : dateMode === "week" ? (
            <WeekPicker selected={selectedDate} onChange={v => { setSelectedDate(v); }} />
          ) : (
            <input className="date-input" type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} />
          )}
        </div>
      </header>

      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice err">{error}</div>}

      {/* ====== Dashboard ====== */}
      {view === "dashboard" && summary && (<div className="view">
        <div className="kpi-grid">
          <KpiCard label="整体消耗" value={money(summary.spend)} accent sub="11个计划合计" />
          <KpiCard label="整体成交金额" value={money(summary.gross_gmv)} sub="商品维度累计" />
          <KpiCard label="净成交金额" value={money(summary.net_gmv)} valueColor={warmOrange} />
          <KpiCard label="⭐ 减15%退货率净ROI" value={roi(summary.conservative_roi)} accent highlight sub="保守预估·扣15%退货损耗" />
        </div>
        <div className="kpi-grid">
          <KpiCard label="整体支付ROI" value={roi(summary.gross_roi)} sub="成交金额÷消耗" />
          <KpiCard label="净成交ROI" value={roi(summary.net_roi)} sub="净成交金额÷消耗" />
          <KpiCard label="净成交订单数" value={numberText(summary.net_orders)} />
          <KpiCard label="1小时退款金额" value={money(summary.refund_amount_1h)} />
        </div>
        <div className="grid-2">
          <div className="card glass"><div className="card-head"><h3>📈 消耗 & 成交趋势</h3><span>日维度 · {data?.trends?.length??0} 天</span></div>
            <div className="card-body">{data?.trends?.length ? <TrendChart trends={data.trends} dateMode={dateMode==="all"?"day":dateMode as any} /> : <div className="chart-placeholder"><span>暂无趋势数据</span></div>}</div></div>
          <div className="card glass"><div className="card-head"><div><h3>🔬 祛痘类投放专项</h3><span>含"苦参"或"祛痘"的 {acne?.products?.length??0} 个产品</span></div><span>消耗占比 <b>{acne?(acne.spend_ratio*100).toFixed(1):0}%</b></span></div>
            <div className="card-body"><div className="acne-grid">
              <div className="acne-card"><span>整体消耗</span><strong>{money(acne?.spend)}</strong></div>
              <div className="acne-card"><span>净成交ROI</span><strong>{roi(acne?.net_roi)}</strong></div>
              <div className="acne-card"><span>净订单数</span><strong>{numberText(acne?.net_orders)}</strong></div>
              <div className="acne-card warm"><span>净成交金额</span><strong>{money(acne?.net_gmv)}</strong></div>
              <div className="acne-card warm"><span>精华霜净成交</span><strong>{numberText(acne?.jinghua_net_orders)}</strong><small>4个套装产品</small></div>
            </div></div></div>
        </div>
        <div className="grid-2">
          <div className="card glass"><div className="card-head"><h3>🏆 消耗 TOP10 视频素材</h3><span>视频维度 · {video?.material_count??0} 个素材</span></div>
            <div className="card-body"><table className="mini-table"><thead><tr><th>#</th><th>素材</th><th>整体消耗</th><th>整体成交</th><th>整体支付ROI</th></tr></thead><tbody>
              {data?.topMaterials?.map((m,i)=>(<tr key={i} onClick={()=>setView("materials")}><td>{i+1}</td><td><strong>{String(m.material_name).slice(0,40)}</strong></td><td>{money(m.spend)}</td><td>{money(m.gross_gmv)}</td><td>{roi(m.gross_roi)}</td></tr>))}
            </tbody></table></div></div>
          {/* Two pie charts side by side */}
          <div className="card glass"><div className="card-head"><h3>📊 素材来源分布</h3></div>
            <div className="card-body" style={{display:"flex",gap:12}}>
              <div style={{flex:1,textAlign:"center"}}>
                <h4 style={{fontSize:12,color:"var(--text-muted)",marginBottom:4}}>按消耗金额</h4>
                {data?.sourceDist?.bySpend?.length ? <PieChart data={data.sourceDist.bySpend} /> : <div className="chart-placeholder" style={{height:180}}><span>暂无数据</span></div>}
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <h4 style={{fontSize:12,color:"var(--text-muted)",marginBottom:4}}>按净成交金额</h4>
                {data?.sourceDist?.byNet?.length ? <PieChart data={data.sourceDist.byNet} /> : <div className="chart-placeholder" style={{height:180}}><span>暂无数据</span></div>}
              </div>
            </div></div>
        </div>
      </div>)}

      {/* ====== Materials ====== */}
      {view === "materials" && (<div className="view">
        {video && (<><div className="kpi-grid"><KpiCard label="视频整体消耗" value={money(video.spend)} accent /><KpiCard label="视频整体成交金额" value={money(video.gross_gmv)} /><KpiCard label="视频整体支付ROI" value={roi(video.gross_roi)} /><KpiCard label="视频净成交ROI" value={roi(video.net_roi)} /></div>
          <div className="kpi-grid"><KpiCard label="视频净成交金额" value={money(video.net_gmv)} valueColor={warmOrange} /><KpiCard label="视频净成交订单数" value={numberText(video.net_orders)} /><KpiCard label="视频播放数" value={numberText(video.plays)} sub={`${video.material_count} 个素材`} /><KpiCard label="视频整体点击率" value={percent(video.avg_click_rate)} /></div></>)}
        <div className="materials-grid">
          <div className="card glass" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{flexWrap:"wrap",gap:8}}><h3>素材列表</h3><div style={{display:"flex",gap:8,alignItems:"center"}}><input className="search-input" placeholder="搜索素材名称..." value={search} onChange={e=>{setSearch(e.target.value);setMaterialPage(1);}} onKeyDown={e=>{if(e.key==="Enter"){setMaterialPage(1);loadMaterials();}}} /><span style={{fontSize:12,color:"var(--text-muted)",whiteSpace:"nowrap"}}>共 {materialTotal} 条</span></div></div>
            <div className="card-body" style={{ overflowX: "auto" }}>
              <table className="mini-table" style={{ minWidth: 780 }}><thead><tr>
                <th style={{ minWidth: 260 }}>素材名称</th>
                <SortTh col="spend" label="整体消耗" currentSort={matSort} currentDir={matSortDir} onClick={changeSort} />
                <SortTh col="gross_roi" label="整体支付ROI" currentSort={matSort} currentDir={matSortDir} onClick={changeSort} />
                <SortTh col="gross_orders" label="成交订单" currentSort={matSort} currentDir={matSortDir} onClick={changeSort} />
                <SortTh col="plays" label="播放数" currentSort={matSort} currentDir={matSortDir} onClick={changeSort} />
                <SortTh col="completion_rate" label="完播率" currentSort={matSort} currentDir={matSortDir} onClick={changeSort} />
                <SortTh col="net_gmv" label="净成交金额" currentSort={matSort} currentDir={matSortDir} onClick={changeSort} />
                <th style={{ width: 56 }}></th>
              </tr></thead><tbody>
                {materials.map(m=>(<tr key={m.id}><td><strong title={String(m.material_name)}>{String(m.material_name).slice(0,42)}{m.material_name.length > 42 ? "..." : ""}</strong></td><td>{money(m.spend)}</td><td>{roi(m.gross_roi)}</td><td>{numberText(m.gross_orders)}</td><td>{numberText(m.plays)}</td><td>{percent(m.completion_rate)}</td><td style={{color:"#c7821a",fontWeight:700}}>{money(m.net_gmv)}</td><td><button className="btn-ghost" style={{padding:"4px 10px",fontSize:12,minHeight:28}} onClick={()=>openDetail(m.id)}>详情</button></td></tr>))}
              </tbody></table>
              {totalPages > 1 && (<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:8,marginTop:14}}>
                <button className="btn-ghost" disabled={materialPage<=1} onClick={()=>setMaterialPage(p=>Math.max(1,p-1))} style={{minWidth:80}}>← 上一页</button>
                <span style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>第 {materialPage}/{totalPages} 页</span>
                <button className="btn-ghost" disabled={materialPage>=totalPages} onClick={()=>setMaterialPage(p=>Math.min(totalPages,p+1))} style={{minWidth:80}}>下一页 →</button>
              </div>)}
            </div></div>
          {detail && (<div className="card glass detail-panel">
            <div className="card-head"><h3>{String(detail.material.material_name).slice(0,40)}</h3><button className="btn-icon" onClick={()=>{setDetail(null);setVideoPaths([]);}}>✕</button></div>
            <div className="card-body">
              <div className="mini-metrics">
                <div className="metric-card"><span>整体消耗</span><strong>{money(detail.material.spend)}</strong></div>
                <div className="metric-card"><span>整体支付ROI</span><strong>{roi(detail.material.gross_roi)}</strong></div>
                <div className="metric-card"><span>整体成交金额</span><strong>{money(detail.material.gross_gmv)}</strong></div>
                <div className="metric-card"><span>净成交ROI</span><strong>{roi(detail.material.net_roi)}</strong></div>
                <div className="metric-card"><span>净成交金额</span><strong style={{color:warmOrange}}>{money(detail.material.net_gmv)}</strong></div>
                <div className="metric-card"><span>净成交订单数</span><strong>{numberText(detail.material.net_orders)}</strong></div>
                <div className="metric-card"><span>千次展现费用</span><strong>{money(detail.material.cpm)}</strong></div>
                <div className="metric-card"><span>整体点击率</span><strong>{percent(detail.material.click_rate)}</strong></div>
                <div className="metric-card"><span>整体转化率</span><strong>{percent(detail.material.conversion_rate)}</strong></div>
                <div className="metric-card"><span>3秒播放率</span><strong>{percent(detail.material.rate_3s)}</strong></div>
                <div className="metric-card"><span>视频完播率</span><strong>{percent(detail.material.completion_rate)}</strong></div>
                <div className="metric-card"><span>播放数</span><strong>{numberText(detail.material.plays)}</strong></div>
              </div>
              {detail.trends.length>0&&(<div style={{marginTop:14}}><h4 style={{fontSize:13,marginBottom:8,color:"var(--text-secondary)"}}>每日消耗趋势 ↓</h4>
                <div className="trend-mini">{detail.trends.slice(-14).map(t=>(<div key={t.metric_date} className="trend-bar" title={`${t.metric_date}: ${money(t.spend)}`}><div className="bar" style={{height:`${Math.max(4,(t.spend/Math.max(...detail.trends.map(x=>x.spend),1))*100)}%`}}/><small>{t.metric_date.slice(5)}</small></div>))}</div></div>)}
              <div style={{marginTop:14}}><h4 style={{fontSize:13,marginBottom:6,color:"var(--text-secondary)"}}>🎴 视频预览 {videoPaths.length>0?`(${videoPaths.length}个)`:"搜索中..."}</h4>
                {videoPaths.length>0?videoPaths.map((vp,i)=>(<div key={i} style={{marginBottom:8}}><small style={{color:"var(--text-muted)",display:"block",marginBottom:4}}>{vp.replace(/^.*[\\/]/,"")}</small><video controls style={{width:"100%",maxHeight:520,borderRadius:8,background:"#000"}} src={`/api/video/stream?path=${encodeURIComponent(vp)}`} preload="metadata"/></div>)):<div style={{textAlign:"center",padding:20,color:"var(--text-muted)",background:"rgba(0,0,0,0.03)",borderRadius:8}}><Video size={24}/><p style={{marginTop:8,fontSize:12}}>选中素材后自动匹配共享盘视频</p></div>}
              </div>
              {isAdmin&&<button className="btn-ghost" style={{marginTop:12}} onClick={async()=>{if(!confirm("确认删除此素材数据？"))return;try{await deleteMaterial(detail.material.id);setDetail(null);loadMaterials();setNotice("已删除");}catch(ex){setError(ex instanceof Error?ex.message:"删除失败");}}}>🗑️ 删除此素材数据</button>}
            </div></div>)}
        </div>
      </div>)}

      {/* ====== Products ====== */}
      {view === "products" && (<div className="view">
        <div className="kpi-grid">
          {acne?.products?.slice(0,4).map((p,i)=>(<div key={i} className={`kpi-card glass ${i===0?"highlight":""}`}>
            <span className="kpi-label">{String(p.name).slice(0,22)}</span>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px",marginTop:10}}>
              <div><span style={{fontSize:10,color:"var(--text-muted)"}}>整体消耗</span><div style={{fontSize:18,fontWeight:900}}>{money(p.spend)}</div></div>
              <div><span style={{fontSize:10,color:"var(--text-muted)"}}>净成交金额</span><div style={{fontSize:18,fontWeight:900,color:warmOrange}}>{money(p.net_gmv)}</div></div>
              <div><span style={{fontSize:10,color:"var(--text-muted)"}}>净成交ROI</span><div style={{fontSize:18,fontWeight:900}}>{roi(p.net_roi)}</div></div>
              <div><span style={{fontSize:10,color:"var(--text-muted)"}}>净成交订单</span><div style={{fontSize:18,fontWeight:900}}>{numberText(p.net_orders)}</div></div>
            </div>
          </div>))}
        </div>
        <div className="card glass"><div className="card-head"><h3>各商品消耗对比</h3></div>
          <div className="card-body">{acne?.products?.length?<BarChart labels={acne.products.map(p=>String(p.name).slice(0,22))} values={acne.products.map(p=>p.spend)} title="消耗"/>:<div className="chart-placeholder"><span>暂无数据</span></div>}</div></div>
      </div>)}

      {/* ====== Plans ====== */}
      {view === "plans" && (<div className="view">
        <div className="card glass"><div className="card-head"><h3>📋 投放计划消耗</h3><span>{data?.planSummary?.length??0} 个计划</span></div>
          <div className="card-body">{data?.planSummary?.length?<BarChart labels={data.planSummary.map(p=>String(p.plan_name).slice(0,22))} values={data.planSummary.map(p=>p.spend)} title="消耗"/>:<div className="chart-placeholder"><span>暂无计划数据</span></div>}</div></div>
        <div className="card glass" style={{marginTop:16}}><div className="card-head"><h3>计划明细</h3></div><div className="card-body"><table className="mini-table"><thead><tr><th>计划名称</th><th>整体消耗</th><th>整体成交金额</th><th>净成交ROI</th><th>净成交订单</th></tr></thead><tbody>
          {data?.planSummary?.map((p,i)=>(<tr key={i}><td><strong>{p.plan_name}</strong></td><td>{money(p.spend)}</td><td>{money(p.gross_gmv)}</td><td>{roi(p.net_roi)}</td><td>{numberText(p.net_orders)}</td></tr>))}</tbody></table></div></div>
      </div>)}

      {/* ====== Reports ====== */}
      {view === "reports" && (<div className="view"><div className="card glass"><div className="card-head"><h3>📈 数据报告</h3><span>日报/周报/月报</span></div><div className="card-body">
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
          <button className="btn-primary" onClick={async()=>{setBusy("report");try{const r=await generateReport("daily",today());setNotice(`日报已生成: ${r.path}`);loadReports();}catch(ex){setError(ex instanceof Error?ex.message:"生成失败");}finally{setBusy("");}}} disabled={busy==="report"}>📄 生成日报</button>
          <button className="btn-primary" onClick={async()=>{setBusy("report");try{const r=await generateReport("weekly");setNotice(`周报已生成: ${r.path}`);loadReports();}catch(ex){setError(ex instanceof Error?ex.message:"生成失败");}finally{setBusy("");}}} disabled={busy==="report"}>📄 生成周报</button>
          <button className="btn-primary" onClick={async()=>{setBusy("report");try{const r=await generateReport("monthly");setNotice(`月报已生成: ${r.path}`);loadReports();}catch(ex){setError(ex instanceof Error?ex.message:"生成失败");}finally{setBusy("");}}} disabled={busy==="report"}>📄 生成月报</button>
          {isAdmin && <button className="btn-ghost" onClick={async()=>{setBusy("push");try{await pushReport("daily");setNotice("日报已推送飞书");}catch(ex){setError(ex instanceof Error?ex.message:"推送失败");}finally{setBusy("");}}} disabled={busy==="push"}>📤 推送日报到飞书</button>}
        </div>
        <h3 style={{marginTop:16,marginBottom:8}}>历史报告</h3><table className="mini-table"><thead><tr><th>类型</th><th>日期</th><th>状态</th><th>飞书链接</th><th>生成时间</th></tr></thead><tbody>
          {reportLogs.map((l:any)=>{const tl:Record<string,string>={daily:"日报",weekly:"周报",monthly:"月报",manual:"手动"};return(<tr key={l.id}><td>{tl[l.report_type]||l.report_type}</td><td>{l.date_from}</td><td>{l.status}</td><td>{l.feishu_url?<a href={l.feishu_url} target="_blank" rel="noreferrer">查看</a>:"-"}</td><td>{l.created_at?.slice(0,19)}</td></tr>);})}
          {!reportLogs.length&&<tr><td colSpan={5} style={{textAlign:"center",color:"var(--text-muted)"}}>暂无报告记录</td></tr>}
        </tbody></table></div></div></div>)}

      {view === "admin" && isAdmin && <AdminPanel />}
    </main>
  </div>);
}
