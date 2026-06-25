import { apiFetch } from "../api";
import type { DashboardData, MaterialMetric, PagedResponse, SyncResult, User } from "../types";

// ====== Auth ======
export function loginUser(username: string, password: string) {
  return apiFetch<{ token: string; user: User }>("/api/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  });
}
export function getCurrentUser() {
  return apiFetch<{ user: User }>("/api/auth/me");
}

// ====== Dashboard (支持日期范围) ======
export function getDashboard(from?: string, to?: string) {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const qs = q.toString();
  return apiFetch<DashboardData>(`/api/dashboard${qs ? `?${qs}` : ""}`);
}

// ====== Materials ======
export function getMaterials(params: { search?: string; sortBy?: string; limit?: number; offset?: number }) {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.sortBy) q.set("sortBy", params.sortBy);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  return apiFetch<PagedResponse<MaterialMetric>>(`/api/materials?${q.toString()}`);
}
export function getMaterialDetail(id: number) {
  return apiFetch<{ material: MaterialMetric; trends: MaterialMetric[] }>(`/api/materials/${id}`);
}
export function deleteMaterial(id: number) {
  return apiFetch<{ ok: boolean }>(`/api/materials/${id}`, { method: "DELETE" });
}

// ====== Sync ======
export function runSync() { return apiFetch<SyncResult>("/api/sync/run", { method: "POST" }); }
export function getSyncDiagnostics() { return apiFetch<any>("/api/sync/diagnostics"); }

// ====== Settings ======
export function getSettings() { return apiFetch<Record<string, string>>("/api/settings"); }
export function updateSettings(data: Record<string, string>) {
  return apiFetch<Record<string, string>>("/api/settings", { method: "POST", body: JSON.stringify(data) });
}

// ====== Reports ======
export function getReports(type?: string) {
  const q = type ? `?type=${type}` : "";
  return apiFetch<{ items: any[] }>(`/api/reports${q}`);
}
export function generateReport(reportType: string, date?: string) {
  return apiFetch<any>("/api/reports/generate", {
    method: "POST", body: JSON.stringify({ reportType, date }),
  });
}
export function pushReport(type: string) {
  return apiFetch<any>(`/api/reports/${type}/push`, { method: "POST" });
}

// ====== Alerts ======
export function getAlerts(level?: string) { return apiFetch<any>(`/api/alerts${level ? `?level=${level}` : ""}`); }
export function checkAlerts() { return apiFetch<any>("/api/alerts/check", { method: "POST" }); }

// ====== Feishu ======
export function getFeishuConfig() { return apiFetch<any>("/api/feishu/config"); }
export function setFeishuChatId(chatId: string) {
  return apiFetch<any>("/api/feishu/config", { method: "POST", body: JSON.stringify({ chatId }) });
}
