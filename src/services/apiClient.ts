import { apiFetch } from "../api";
import type { DashboardData, MaterialMetric, PagedResponse, SyncResult, User } from "../types";

// ====== Auth ======
export function loginUser(username: string, password: string) {
  return apiFetch<{ token: string; user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getCurrentUser() {
  return apiFetch<{ user: User }>("/api/auth/me");
}

// ====== Dashboard ======
export function getDashboard() {
  return apiFetch<DashboardData>("/api/dashboard");
}

// ====== Materials ======
export function getMaterials(params: {
  search?: string;
  sortBy?: string;
  limit?: number;
  offset?: number;
}) {
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
export function runSync() {
  return apiFetch<SyncResult>("/api/sync/run", { method: "POST" });
}

export function getSyncDiagnostics() {
  return apiFetch<any>("/api/sync/diagnostics");
}

// ====== Settings ======
export function getSettings() {
  return apiFetch<Record<string, string>>("/api/settings");
}

export function updateSettings(data: Record<string, string>) {
  return apiFetch<Record<string, string>>("/api/settings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
