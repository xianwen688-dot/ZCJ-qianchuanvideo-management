import { useState, useEffect } from "react";
import { Settings, FileText, Bell, AlertTriangle, RefreshCw } from "lucide-react";
import { getSettings, updateSettings, getFeishuConfig, setFeishuChatId, getReports, getAlerts, checkAlerts } from "../services/apiClient";

export function AdminPanel() {
  const [tab, setTab] = useState<"settings" | "reports" | "alerts">("settings");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [feishuConfig, setFeishuConfig] = useState<any>({});
  const [chatId, setChatId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reportLogs, setReportLogs] = useState<any[]>([]);
  const [alertItems, setAlertItems] = useState<any[]>([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    loadSettings();
    loadFeishu();
    loadReports();
    loadAlerts();
  }, []);

  async function loadSettings() {
    try { const s = await getSettings(); setSettings(s); setChatId(s.feishuChatId || ""); } catch { /* */ }
  }
  async function loadFeishu() {
    try { setFeishuConfig(await getFeishuConfig()); } catch { /* */ }
  }
  async function loadReports() {
    try { setReportLogs((await getReports()).items); } catch { /* */ }
  }
  async function loadAlerts() {
    try { setAlertItems((await getAlerts()).items); } catch { /* */ }
  }

  async function saveSetting(key: string, value: string) {
    try { await updateSettings({ [key]: value }); setNotice(`已保存: ${key}`); } catch (ex) { setError(ex instanceof Error ? ex.message : "保存失败"); }
  }
  async function saveFeishuChatId() {
    try { await setFeishuChatId(chatId); setNotice("飞书群聊ID已保存"); } catch (ex) { setError(ex instanceof Error ? ex.message : "保存失败"); }
  }
  async function runAlertCheck() {
    setBusy("alerts");
    try { const r = await checkAlerts(); setNotice(`预警检查完成: ${r.fresh} 条新预警 (高:${r.high} 中:${r.medium})`); loadAlerts(); } catch (ex) { setError(ex instanceof Error ? ex.message : "检查失败"); }
    finally { setBusy(""); }
  }

  const typeLabel: Record<string, string> = { daily: "日报", weekly: "周报", monthly: "月报", manual: "手动" };
  const levelLabel: Record<string, string> = { high: "🔴 高", medium: "🟠 中", low: "🟡 低", positive: "🟢 正向" };

  return (
    <div className="view">
      <div style={{ display: "flex", gap: 4, padding: 6, background: "var(--glass-bg)", backdropFilter: "blur(8px)", border: "1px solid var(--glass-border)", borderRadius: 12, marginBottom: 16, width: "fit-content" }}>
        <button className={`btn-text ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}><Settings size={16} /> 系统设置</button>
        <button className={`btn-text ${tab === "reports" ? "active" : ""}`} onClick={() => { setTab("reports"); loadReports(); }}><FileText size={16} /> 报告日志</button>
        <button className={`btn-text ${tab === "alerts" ? "active" : ""}`} onClick={() => { setTab("alerts"); loadAlerts(); }}><Bell size={16} /> 预警历史</button>
      </div>

      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice err">{error}</div>}

      {tab === "settings" && (
        <div className="grid-2">
          <div className="card glass"><div className="card-head"><h3>📡 数据路径</h3></div><div className="card-body">
            <label>数据导入路径 <input value={settings.reportInboxPath || ""} onChange={e => setSettings(s => ({...s, reportInboxPath: e.target.value}))} /></label>
            <label>脚本根路径 <input value={settings.scriptRootPath || ""} onChange={e => setSettings(s => ({...s, scriptRootPath: e.target.value}))} /></label>
            <button className="btn-primary" style={{marginTop:8}} onClick={()=>{saveSetting("reportInboxPath",settings.reportInboxPath);saveSetting("scriptRootPath",settings.scriptRootPath)}}>💾 保存路径</button>
          </div></div>
          <div className="card glass"><div className="card-head"><h3>✈️ 飞书通知</h3></div><div className="card-body">
            <label>当前状态: <b>{feishuConfig?.configured ? "✅ 已配置" : "⚠️ 未配置(lark-cli bot不在群)"}</b></label>
            <label>CLI Profile <input value={feishuConfig?.profile || ""} readOnly /></label>
            <label>群聊 Chat ID <input value={chatId} onChange={e => setChatId(e.target.value)} /></label>
            <button className="btn-primary" style={{marginTop:8}} onClick={saveFeishuChatId}>💾 保存飞书配置</button>
            <small style={{marginTop:8,display:"block",color:"var(--text-muted)"}}>定时推送需 lark-cli bot 在群内 · 当前通过管理面板手动推送</small>
          </div></div>
          <div className="card glass"><div className="card-head"><h3>⏰ 定时任务</h3></div><div className="card-body">
            <label>日报时间 <input value={settings.dailySyncTime||"09:30"} onChange={e=>setSettings(s=>({...s,dailySyncTime:e.target.value}))} /></label>
            <label>预警阈值(ROI) <input value={settings.roiAlertThreshold||"0.5"} onChange={e=>setSettings(s=>({...s,roiAlertThreshold:e.target.value}))} /></label>
            <button className="btn-primary" style={{marginTop:8}} onClick={()=>{saveSetting("dailySyncTime",settings.dailySyncTime);saveSetting("roiAlertThreshold",settings.roiAlertThreshold)}}>💾 保存任务</button>
            <small style={{marginTop:8,display:"block",color:"var(--text-muted)"}}>日报: 每日{settings.dailySyncTime||"09:30"} · 周报: 周一 · 月报: 1日 · 预警: 每小时</small>
          </div></div>
          <div className="card glass"><div className="card-head"><h3>🔐 系统信息</h3></div><div className="card-body">
            <label>端口: <b>8788</b></label>
            <label>地址: <b>http://{window.location.hostname}:8788</b></label>
            <label>数据库: SQLite (WAL)</label>
            <label>管理员: admin</label>
            <label>旧项目端口: 8787 (独立运行)</label>
          </div></div>
        </div>
      )}

      {tab === "reports" && (
        <div className="card glass"><div className="card-head"><h3>📋 报告生成日志</h3><span>{reportLogs.length} 条</span></div><div className="card-body">
          {reportLogs.length ? (
            <table className="mini-table">
              <thead><tr><th>类型</th><th>日期</th><th>状态</th><th>路径</th><th>时间</th></tr></thead>
              <tbody>
                {reportLogs.map((l: any) => (
                  <tr key={l.id}><td>{typeLabel[l.report_type]||l.report_type}</td><td>{l.date_from}</td><td>✅ {l.status}</td><td style={{fontSize:11,fontFamily:"monospace"}}>{l.content_path||"-"}</td><td>{l.created_at?.slice(0,19)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="chart-placeholder"><FileText size={32} /><span>暂无报告记录</span><small>生成报告后在此查看</small></div>}
        </div></div>
      )}

      {tab === "alerts" && (
        <div className="card glass"><div className="card-head"><h3>🚨 预警历史</h3><div style={{display:"flex",gap:8}}><button className="btn-ghost" disabled={busy==="alerts"} onClick={runAlertCheck}><RefreshCw size={14} className={busy==="alerts"?"spin":""} /> 手动检查</button></div></div><div className="card-body">
          {alertItems.length ? (
            <table className="mini-table">
              <thead><tr><th>级别</th><th>类型</th><th>素材/指标</th><th>详情</th><th>时间</th></tr></thead>
              <tbody>
                {alertItems.map((a: any) => (
                  <tr key={a.id}><td>{levelLabel[a.level]||a.level}</td><td>{a.alert_type||"-"}</td><td>{a.target_name||"-"}</td><td style={{maxWidth:300,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.message||"-"}</td><td>{a.created_at?.slice(0,19)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="chart-placeholder"><AlertTriangle size={32} /><span>暂无预警</span><small>🔴高 🟠中 🟡低 🟢正向 · 每小时自动检查 · 点击"手动检查"立即执行</small></div>}
        </div></div>
      )}
    </div>
  );
}
