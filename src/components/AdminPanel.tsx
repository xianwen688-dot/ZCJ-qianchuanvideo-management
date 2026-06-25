import { useState, useEffect } from "react";
import { Shield, AlertTriangle, FileText, Settings, Bell } from "lucide-react";
import { getSettings, updateSettings, getFeishuConfig, setFeishuChatId } from "../services/apiClient";
import { money, numberText, roi } from "../lib/format";

export function AdminPanel() {
  const [tab, setTab] = useState<"settings" | "reports" | "alerts">("settings");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [feishuConfig, setFeishuConfig] = useState<any>({});
  const [chatId, setChatId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadSettings();
    loadFeishu();
  }, []);

  async function loadSettings() {
    try {
      const s = await getSettings();
      setSettings(s);
      setChatId(s.feishuChatId || "");
    } catch { /* ignore */ }
  }

  async function loadFeishu() {
    try {
      const c = await getFeishuConfig();
      setFeishuConfig(c);
    } catch { /* ignore */ }
  }

  async function saveSetting(key: string, value: string) {
    try {
      await updateSettings({ [key]: value });
      setNotice(`已保存: ${key}`);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "保存失败");
    }
  }

  async function saveFeishuChatId() {
    try {
      await setFeishuChatId(chatId);
      setNotice("飞书群聊ID已保存");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "保存失败");
    }
  }

  return (
    <div className="view">
      <div className="tabs glass" style={{ display: "flex", gap: 4, padding: 6, borderRadius: 12, marginBottom: 16 }}>
        <button className={`btn-text ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          <Settings size={16} /> 系统设置
        </button>
        <button className={`btn-text ${tab === "reports" ? "active" : ""}`} onClick={() => setTab("reports")}>
          <FileText size={16} /> 报告日志
        </button>
        <button className={`btn-text ${tab === "alerts" ? "active" : ""}`} onClick={() => setTab("alerts")}>
          <Bell size={16} /> 预警历史
        </button>
      </div>

      {notice && <div className="notice ok">{notice}</div>}
      {error && <div className="notice err">{error}</div>}

      {tab === "settings" && (
        <div className="grid-2">
          <div className="card glass">
            <div className="card-head"><h3>📡 数据路径</h3></div>
            <div className="card-body">
              <label>数据导入路径 <input value={settings.reportInboxPath || ""} onChange={e => setSettings(s => ({ ...s, reportInboxPath: e.target.value }))} /></label>
              <label>脚本根路径 <input value={settings.scriptRootPath || ""} onChange={e => setSettings(s => ({ ...s, scriptRootPath: e.target.value }))} /></label>
              <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => { saveSetting("reportInboxPath", settings.reportInboxPath); saveSetting("scriptRootPath", settings.scriptRootPath); }}>
                💾 保存路径配置
              </button>
            </div>
          </div>

          <div className="card glass">
            <div className="card-head"><h3>✈️ 飞书通知</h3></div>
            <div className="card-body">
              <label>当前状态: <b>{feishuConfig?.configured ? "✅ 已配置" : "⚠️ 未配置"}</b></label>
              <label>CLI Profile <input value={feishuConfig?.profile || ""} readOnly /></label>
              <label>群聊 Chat ID <input value={chatId} placeholder="oc_xxx..." onChange={e => setChatId(e.target.value)} /></label>
              <button className="btn-primary" style={{ marginTop: 8 }} onClick={saveFeishuChatId}>
                💾 保存飞书配置
              </button>
              <small style={{ marginTop: 8, display: "block", color: "var(--text-muted)" }}>
                配置后每日9:30自动推送日报到指定群聊
              </small>
            </div>
          </div>

          <div className="card glass">
            <div className="card-head"><h3>⏰ 定时任务</h3></div>
            <div className="card-body">
              <label>日报推送时间 <input value={settings.dailySyncTime || "09:30"} onChange={e => setSettings(s => ({ ...s, dailySyncTime: e.target.value }))} /></label>
              <label>预警阈值(ROI) <input value={settings.roiAlertThreshold || "0.5"} onChange={e => setSettings(s => ({ ...s, roiAlertThreshold: e.target.value }))} /></label>
              <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => { saveSetting("dailySyncTime", settings.dailySyncTime); saveSetting("roiAlertThreshold", settings.roiAlertThreshold); }}>
                💾 保存任务配置
              </button>
              <small style={{ marginTop: 8, display: "block", color: "var(--text-muted)" }}>
                日报: 每日 {settings.dailySyncTime || "09:30"} · 周报: 周一 · 月报: 每月1日 · 预警: 每小时
              </small>
            </div>
          </div>

          <div className="card glass">
            <div className="card-head"><h3>🔐 系统信息</h3></div>
            <div className="card-body">
              <label>系统端口: <b>8787</b></label>
              <label>访问地址: <b>http://主机名:8787</b></label>
              <label>数据库: SQLite (WAL模式)</label>
              <label>管理员: admin / ZCJ@2026</label>
            </div>
          </div>
        </div>
      )}

      {tab === "reports" && (
        <div className="card glass">
          <div className="card-head"><h3>📋 报告生成日志</h3><span>最近50条</span></div>
          <div className="card-body">
            <div className="chart-placeholder">
              <FileText size={32} />
              <span>报告历史查看</span>
              <small>生成报告后在此查看飞书链接和本地路径</small>
            </div>
          </div>
        </div>
      )}

      {tab === "alerts" && (
        <div className="card glass">
          <div className="card-head"><h3>🚨 预警历史</h3><span>最近100条</span></div>
          <div className="card-body">
            <div className="chart-placeholder">
              <AlertTriangle size={32} />
              <span>预警记录</span>
              <small>🔴高 🟠中 🟡低 🟢正向 · 每小时自动检查</small>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
