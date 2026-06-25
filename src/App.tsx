import { useEffect, useState, useCallback } from "react";
import {
  BarChart3, FileSpreadsheet, LogOut, RefreshCw, Shield, Video,
} from "lucide-react";
import { clearToken, getToken, setToken } from "./api";
import {
  getDashboard, getMaterials, getMaterialDetail, deleteMaterial,
  runSync, getCurrentUser, loginUser,
} from "./services/apiClient";
import type { User, DashboardData, MaterialMetric, DateMode } from "./types";
import { getDateRange, rangeLabel, today } from "./lib/date";
import { money, numberText, percent, roi } from "./lib/format";
import { TrendChart } from "./components/TrendChart";
import { PieChart } from "./components/PieChart";
import { BarChart } from "./components/BarChart";

// ====== Login ======
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [show, setShow] = useState(false);
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await loginUser(u, p); setToken(r.token); onLogin(r.user); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : "登录失败"); }
    finally { setBusy(false); }
  }

  return (
    <main className="login-shell">
      <form className="login-card glass" onSubmit={submit}>
        <div className="logo-icon">🎬</div>
        <h1>抖音视频投放管理</h1>
        <button type="button" className="btn-ghost" onClick={() => onLogin({ id: 0, username: "访客", role: "viewer" })}>直接访问（只读）</button>
        <button type="button" className="btn-text" onClick={() => setShow(v => !v)}><Shield size={16} /> 管理员登录</button>
        {show && <>
          <label>账号 <input value={u} autoComplete="username" onChange={e => setU(e.target.value)} /></label>
          <label>密码 <input value={p} type="password" autoComplete="current-password" onChange={e => setP(e.target.value)} /></label>
        </>}
        {err && <p className="error">{err}</p>}
        {show && <button className="btn-primary" disabled={busy} type="submit"><Shield size={16} /> {busy ? "登录中..." : "确认登录"}</button>}
      </form>
    </main>
  );
}

// ====== KPI Card ======
function KpiCard({ label, value, sub, accent, highlight }: {
  label: string; value: string; sub?: string; accent?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`kpi-card glass ${highlight ? "highlight" : ""}`}>
      <span className="kpi-label">{label}</span>
      <strong className={accent ? "kpi-accent" : ""}>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// ====== App ======
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"dashboard" | "materials">("dashboard");
  const [data, setData] = useState<DashboardData | null>(null);
  const [materials, setMaterials] = useState<MaterialMetric[]>([]);
  const [detail, setDetail] = useState<{ material: MaterialMetric; trends: MaterialMetric[] } | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("day");
  const [selectedDate, setSelectedDate] = useState(today());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");

  const isAdmin = user?.role === "admin";
  const range = getDateRange(selectedDate, dateMode);
  const summary = data?.summary;
  const acne = data?.acne;
  const video = data?.video;

  const loadData = useCallback(async () => {
    try { setData(await getDashboard()); setError(""); }
    catch (ex) { setError(ex instanceof Error ? ex.message : "加载失败"); }
  }, []);

  const loadMaterials = useCallback(async () => {
    try {
      const r = await getMaterials({ search: search || undefined, limit: 20 });
      setMaterials(r.items);
    } catch { /* ignore */ }
  }, [search]);

  useEffect(() => {
    if (!getToken()) return;
    getCurrentUser().then(r => setUser(r.user)).catch(() => clearToken());
  }, []);

  useEffect(() => { if (user) { loadData(); loadMaterials(); } }, [user, loadData, loadMaterials]);

  async function doSync() {
    setBusy("sync"); setNotice(""); setError("");
    try {
      const r = await runSync();
      setNotice(`同步完成: ${r.files.length} 文件, ${r.totalRows} 行`);
      await loadData(); await loadMaterials();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "同步失败"); }
    finally { setBusy(""); }
  }

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logo-icon">🎬</div>
          <div><strong>中草集</strong><span>抖音投放管理</span></div>
        </div>
        <nav>
          <button className={`nav-btn ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}><BarChart3 size={18} /> 数据仪表盘</button>
          <button className={`nav-btn ${view === "materials" ? "active" : ""}`} onClick={() => setView("materials")}><FileSpreadsheet size={18} /> 视频素材</button>
        </nav>
        {isAdmin && (
          <button className="btn-ghost sync-btn" disabled={busy === "sync"} onClick={doSync}><RefreshCw size={16} className={busy === "sync" ? "spin" : ""} /> 同步数据</button>
        )}
        <div className="user-row">
          <div className="avatar">{(user.username || "?")[0].toUpperCase()}</div>
          <div><span>{user.username}</span><small>{isAdmin ? "管理员" : "只读"}</small></div>
          {isAdmin && <button className="btn-icon" title="退出" onClick={() => { clearToken(); setUser(null); }}><LogOut size={16} /></button>}
        </div>
      </aside>

      {/* Main */}
      <main className="content">
        {/* Topbar */}
        <header className="topbar glass">
          <div>
            <h2>{view === "dashboard" ? "数据仪表盘" : "视频素材"}</h2>
            <span>{rangeLabel(range)}</span>
          </div>
          <div className="filters">
            <div className="segmented">
              {(["day", "week", "month"] as DateMode[]).map(m => (
                <button key={m} className={dateMode === m ? "active" : ""} onClick={() => setDateMode(m)}>
                  {{ day: "日", week: "周", month: "月" }[m]}
                </button>
              ))}
            </div>
            <input className="date-input" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
          </div>
        </header>

        {notice && <div className="notice ok">{notice}</div>}
        {error && <div className="notice err">{error}</div>}

        {/* ====== Dashboard View ====== */}
        {view === "dashboard" && summary && (
          <div className="view">
            {/* KPI Row 1 */}
            <div className="kpi-grid">
              <KpiCard label="整体消耗" value={money(summary.spend)} accent sub="11个计划合计·商品维度" />
              <KpiCard label="整体成交金额" value={money(summary.gross_gmv)} sub={`整体支付ROI ${roi(summary.gross_roi)}`} />
              <KpiCard label="净成交金额" value={money(summary.net_gmv)} sub={`净成交ROI ${roi(summary.net_roi)} · 净订单 ${numberText(summary.net_orders)}`} />
              <KpiCard label="⭐ 减15%退货率净ROI" value={roi(summary.conservative_roi)} accent highlight sub="保守预估·扣15%退货损耗" />
            </div>

            {/* KPI Row 2 */}
            <div className="kpi-grid">
              <KpiCard label="整体支付ROI" value={roi(summary.gross_roi)} />
              <KpiCard label="净成交ROI" value={roi(summary.net_roi)} />
              <KpiCard label="净成交订单数" value={numberText(summary.net_orders)} />
              <KpiCard label="1小时退款金额" value={money(summary.refund_amount_1h)} />
            </div>

            {/* Row: Trends + Acne */}
            <div className="grid-2">
              <div className="card glass">
                <div className="card-head">
                  <h3>📈 消耗 & 成交趋势</h3>
                  <span>日维度 · {data?.trends?.length ?? 0} 天</span>
                </div>
                <div className="card-body">
                  {data?.trends ? <TrendChart trends={data.trends} dateMode={dateMode} /> : (
                    <div className="chart-placeholder"><span>暂无趋势数据</span></div>
                  )}
                </div>
              </div>

              <div className="card glass">
                <div className="card-head">
                  <div>
                    <h3>🔬 祛痘类投放专项</h3>
                    <span>含"苦参"或"祛痘"的 {acne?.products?.length ?? 0} 个产品</span>
                  </div>
                  <span>消耗占比 <b>{acne ? (acne.spend_ratio * 100).toFixed(1) : 0}%</b></span>
                </div>
                <div className="card-body">
                  <div className="acne-grid">
                    <div className="acne-card"><span>整体消耗</span><strong>{money(acne?.spend)}</strong></div>
                    <div className="acne-card"><span>净成交ROI</span><strong>{roi(acne?.net_roi)}</strong></div>
                    <div className="acne-card"><span>净订单数</span><strong>{numberText(acne?.net_orders)}</strong></div>
                    <div className="acne-card warm"><span>净成交金额</span><strong>{money(acne?.net_gmv)}</strong></div>
                    <div className="acne-card warm"><span>精华霜净成交</span><strong>{numberText(acne?.jinghua_net_orders)}</strong><small>4个套装产品</small></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Row: TOP10 + Source */}
            <div className="grid-2">
              <div className="card glass">
                <div className="card-head">
                  <h3>🏆 消耗 TOP10 视频素材</h3>
                  <span>视频维度 · {video?.material_count ?? 0} 个素材</span>
                </div>
                <div className="card-body">
                  <table className="mini-table">
                    <thead><tr><th>#</th><th>素材</th><th>消耗</th><th>成交</th><th>ROI</th></tr></thead>
                    <tbody>
                      {data?.topMaterials?.map((m, i) => (
                        <tr key={m.id} onClick={() => setView("materials")}>
                          <td>{i + 1}</td>
                          <td><strong>{m.material_name.slice(0, 40)}{m.material_name.length > 40 ? "..." : ""}</strong></td>
                          <td>{money(m.spend)}</td>
                          <td>{money(m.gross_gmv)}</td>
                          <td>{roi(m.gross_roi)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card glass">
                <div className="card-head">
                  <h3>📊 素材来源分布</h3>
                  <span>按来源分类消耗占比</span>
                </div>
                <div className="card-body">
                  {data?.sourceDist?.length ? <PieChart data={data.sourceDist} /> : (
                    <div className="chart-placeholder"><span>暂无来源数据</span></div>
                  )}
                </div>
              </div>
            </div>

            {/* Row: Plan Budget + Video Preview */}
            <div className="grid-2" style={{ marginTop: 16 }}>
              <div className="card glass">
                <div className="card-head">
                  <h3>📋 投放计划消耗</h3>
                  <span>{data?.planSummary?.length ?? 0} 个计划</span>
                </div>
                <div className="card-body">
                  {data?.planSummary?.length ? (
                    <BarChart
                      labels={data.planSummary.slice(0, 11).map(p => p.plan_name.length > 18 ? p.plan_name.slice(0, 18) + "..." : p.plan_name)}
                      values={data.planSummary.slice(0, 11).map(p => p.spend)}
                      title="消耗"
                    />
                  ) : (
                    <div className="chart-placeholder"><span>暂无计划数据</span></div>
                  )}
                </div>
              </div>

              <div className="card glass">
                <div className="card-head">
                  <h3>🎴 视频素材预览</h3>
                  <span>关联共享盘视频 · 同名匹配</span>
                </div>
                <div className="card-body" style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>
                  <Video size={32} /><p>素材详情页将嵌入 HTML5 播放器</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====== Materials View ====== */}
        {view === "materials" && (
          <div className="view">
            {/* Video summary KPI */}
            {video && (
              <div className="kpi-grid">
                <KpiCard label="视频整体消耗" value={money(video.spend)} accent />
                <KpiCard label="视频整体成交" value={money(video.gross_gmv)} />
                <KpiCard label="视频支付ROI" value={roi(video.gross_roi)} />
                <KpiCard label="视频播放数" value={numberText(video.plays)} />
              </div>
            )}

            <div className="grid-2">
              <div className="card glass">
                <div className="card-head">
                  <h3>素材列表</h3>
                  <input className="search-input" placeholder="搜索素材名称..." value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") loadMaterials(); }} />
                </div>
                <div className="card-body">
                  <table className="mini-table">
                    <thead><tr><th>素材名称</th><th>消耗</th><th>成交</th><th>ROI</th><th>播放</th><th>完播率</th><th></th></tr></thead>
                    <tbody>
                      {materials.map(m => (
                        <tr key={m.id}>
                          <td><strong>{m.material_name.slice(0, 50)}{m.material_name.length > 50 ? "..." : ""}</strong></td>
                          <td>{money(m.spend)}</td><td>{money(m.gross_gmv)}</td><td>{roi(m.gross_roi)}</td>
                          <td>{numberText(m.plays)}</td><td>{percent(m.completion_rate)}</td>
                          <td>
                            <button className="btn-text" onClick={async () => {
                              try { setDetail(await getMaterialDetail(m.id)); } catch { /* ignore */ }
                            }}>详情</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {detail && (
                <div className="card glass detail-panel">
                  <div className="card-head">
                    <h3>{detail.material.material_name.slice(0, 40)}</h3>
                    <button className="btn-icon" onClick={() => setDetail(null)}>✕</button>
                  </div>
                  <div className="card-body">
                    <div className="mini-metrics">
                      <div className="metric-card"><span>消耗</span><strong>{money(detail.material.spend)}</strong></div>
                      <div className="metric-card"><span>成交</span><strong>{money(detail.material.gross_gmv)}</strong></div>
                      <div className="metric-card"><span>ROI</span><strong>{roi(detail.material.gross_roi)}</strong></div>
                      <div className="metric-card"><span>播放</span><strong>{numberText(detail.material.plays)}</strong></div>
                      <div className="metric-card"><span>3s播放率</span><strong>{percent(detail.material.rate_3s)}</strong></div>
                      <div className="metric-card"><span>完播率</span><strong>{percent(detail.material.completion_rate)}</strong></div>
                    </div>
                    {detail.trends.length > 0 && (
                      <div className="trend-mini" style={{ marginTop: 12 }}>
                        {detail.trends.slice(-14).map(t => (
                          <div key={t.metric_date} className="trend-bar" title={`${t.metric_date}: ${money(t.spend)}`}>
                            <div className="bar" style={{ height: `${Math.max(4, (t.spend / Math.max(...detail.trends.map(x => x.spend), 1)) * 100)}%` }} />
                            <small>{t.metric_date.slice(5)}</small>
                          </div>
                        ))}
                      </div>
                    )}
                    {isAdmin && (
                      <button className="btn-ghost" style={{ marginTop: 12 }} onClick={async () => {
                        if (!confirm("确认删除此素材数据？")) return;
                        try { await deleteMaterial(detail.material.id); setDetail(null); loadMaterials(); setNotice("已删除"); }
                        catch (ex) { setError(ex instanceof Error ? ex.message : "删除失败"); }
                      }}>🗑️ 删除此素材数据</button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Video Preview Placeholder */}
            <div className="card glass" style={{ marginTop: 16 }}>
              <div className="card-head">
                <h3>🎴 视频预览</h3>
                <span>关联 Z:\...\3剪辑成片\抖音信息流\ · 同名匹配（后续版本）</span>
              </div>
              <div className="card-body chart-placeholder" style={{ padding: 30 }}>
                <Video size={32} /><span>选中素材后，匹配共享盘同名视频文件进行播放</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
