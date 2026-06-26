// ====== 用户 ======
export interface User {
  id: number;
  username: string;
  role: "admin" | "viewer";
}

// ====== 商品指标 ======
export interface ProductMetric {
  id: number;
  product_id: string;
  product_name: string;
  metric_date: string;
  impressions: number;
  clicks: number;
  click_rate: number;
  conversion_rate: number;
  spend: number;
  gross_gmv: number;
  gross_roi: number;
  order_cost: number;
  gross_orders: number;
  actual_pay_amount: number;
  platform_subsidy: number;
  net_roi: number;
  net_gmv: number;
  net_orders: number;
  net_order_cost: number;
  net_settlement_rate: number;
  refund_rate_1h: number;
  refund_amount_1h: number;
  gmv_settlement_rate_7d: number;
}

// ====== 视频素材 ======
export interface MaterialMetric {
  id: number;
  material_id: string;
  material_name: string;
  material_created_at: string;
  metric_date: string;
  impressions: number;
  clicks: number;
  click_rate: number;
  conversion_rate: number;
  spend: number;
  gross_orders: number;
  gross_gmv: number;
  gross_roi: number;
  order_cost: number;
  cpm: number;
  cpc: number;
  net_roi: number;
  net_gmv: number;
  net_orders: number;
  net_order_cost: number;
  net_settlement_rate: number;
  refund_rate_1h: number;
  refund_amount_1h: number;
  plays: number;
  completion_rate: number;
  avg_watch_seconds: number;
  rate_3s: number;
  rate_5s: number;
}

// ====== Dashboard 数据 ======
export interface ProductSummary {
  spend: number;
  gross_gmv: number;
  gross_roi: number;
  net_gmv: number;
  net_roi: number;
  net_orders: number;
  gross_orders: number;
  refund_amount_1h: number;
  conservative_roi: number;
}

export interface AcneProduct {
  name: string;
  spend: number;
  net_gmv: number;
  net_roi: number;
  net_orders: number;
}

export interface AcneStats {
  spend: number;
  net_gmv: number;
  net_roi: number;
  net_orders: number;
  refund_amount_1h: number;
  spend_ratio: number;
  jinghua_net_orders: number;
  products: AcneProduct[];
}

export interface VideoSummary {
  spend: number;
  gross_gmv: number;
  gross_roi: number;
  net_gmv: number;
  net_roi: number;
  net_orders: number;
  plays: number;
  clicks: number;
  impressions: number;
  material_count: number;
  avg_click_rate: number;
}

export interface TrendPoint {
  date: string;
  spend: number;
  gmv: number;
  net_gmv: number;
  orders: number;
}

export interface SourceDist {
  label: string;
  value: number;
}

export interface PlanSummary {
  plan_name: string;
  spend: number;
  gross_gmv: number;
  gross_roi: number;
  net_gmv: number;
  net_roi: number;
  net_orders: number;
}

export interface DashboardData {
  summary: ProductSummary;
  acne: AcneStats;
  video: VideoSummary;
  topMaterials: MaterialMetric[];
  trends: TrendPoint[];
  topByRoi: MaterialMetric[];
  topByOrders: MaterialMetric[];
  sourceDist: SourceDist[];
  planSummary: PlanSummary[];
}

// ====== API 通用类型 ======
export interface PagedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  files: Array<{
    fileType: string;
    fileName: string;
    rows: number;
    inserted: number;
    skipped: boolean;
  }>;
  totalRows: number;
  errors: string[];
}

export interface Job {
  id: number;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  target_type: string;
  target_id: string;
  progress_current: number;
  progress_total: number;
  result_json: string;
  error: string;
  created_at: string;
}

export type DateMode = "day" | "week" | "month" | "custom" | "all";
