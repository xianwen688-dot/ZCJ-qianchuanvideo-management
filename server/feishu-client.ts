import fs from "node:fs";
import path from "node:path";
import { db, setSetting } from "./db";

const BOT_APP_ID = process.env.FEISHU_APP_ID || "";
const BOT_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const FEISHU_API = "https://open.feishu.cn/open-apis";

let cachedToken = "";
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const r = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: BOT_APP_ID, app_secret: BOT_APP_SECRET }),
  });
  const data = await r.json() as any;
  cachedToken = data.tenant_access_token || "";
  tokenExpiry = Date.now() + (data.expire || 7200) * 1000;
  return cachedToken;
}

async function api(method: string, url: string, body?: any): Promise<any> {
  const token = await getToken();
  const opts: any = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(`${FEISHU_API}${url}`, opts);
  return r.json();
}

function getChatId(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'feishuChatId'").get() as { value: string } | undefined;
  return row?.value || "oc_247ba5bf8af048ba1bd402ede971935e";
}

// ====== Create Feishu Doc from Markdown ======
async function createFeishuDoc(title: string, content: string): Promise<string | null> {
  try {
    // Step 1: Create empty doc
    const create = await api("POST", "/docx/v1/documents", { title });
    if (create.code !== 0) { console.error("[feishu] 创建文档失败:", create.msg); return null; }
    const docId = create.data.document.document_id;

    // Step 2: Convert markdown lines to blocks
    const lines = content.split("\n");
    const blocks: any[] = [];
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      if (s.startsWith("# ") && !s.startsWith("## ")) {
        blocks.push(h(3, s.slice(2)));
      } else if (s.startsWith("## ")) {
        blocks.push(h(4, s.slice(3)));
      } else if (s.startsWith("### ")) {
        blocks.push(h(5, s.slice(4)));
      } else if (s === "---") {
        blocks.push(t("━━━━━━━━━━━━"));
      } else if (s.startsWith("> ")) {
        blocks.push(t(s.slice(2)));
      } else {
        blocks.push(t(s));
      }
    }

    // Step 3: Write blocks in batches
    const BATCH = 50;
    let total = 0;
    for (let i = 0; i < blocks.length; i += BATCH) {
      const batch = blocks.slice(i, i + BATCH);
      const r = await api("POST", `/docx/v1/documents/${docId}/blocks/${docId}/children`, { children: batch, index: -1 });
      if (r.code === 0) total += batch.length;
    }
    console.log(`[feishu] 文档创建完成: ${total}/${blocks.length} blocks`);
    return `https://bytedance.feishu.cn/docx/${docId}`;
  } catch (err) {
    console.error("[feishu] 文档创建异常:", err);
    return null;
  }
}

function h(type: number, text: string) {
  const key = type === 3 ? "heading1" : type === 4 ? "heading2" : "heading3";
  return { block_type: type, [key]: { elements: [{ text_run: { content: text, text_element_style: {} } }], style: {} } };
}
function t(text: string) {
  return { block_type: 2, text: { elements: [{ text_run: { content: text, text_element_style: {} } }], style: {} } };
}

// ====== Send IM ======
async function sendIM(text: string): Promise<boolean> {
  try {
    const r = await api("POST", `/im/v1/messages?receive_id_type=chat_id`, {
      receive_id: getChatId(),
      msg_type: "text",
      content: JSON.stringify({ text }),
    });
    return r.code === 0;
  } catch { return false; }
}

// For alerts.ts compatibility
export async function sendFeishuMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const ok = await sendIM(text);
  return ok ? { ok: true } : { ok: false, error: "发送失败" };
}

// ====== Push report: doc + IM link ======
export async function pushReport(title: string, content: string, reportType: string) {
  const emoji = reportType === "daily" ? "📊" : reportType === "weekly" ? "📈" : "📋";

  // Try creating feishu doc
  const docUrl = await createFeishuDoc(title, content);

  if (docUrl) {
    const ok = await sendIM(`${emoji} ${title}\n📄 ${docUrl}\n\n🤖 抖音视频投放管理系统`);
    console.log(`[feishu] ${reportType}报告 → ${docUrl}`);
    return { ok, url: docUrl };
  }

  // Fallback: full text IM
  const maxLen = 28000;
  const text = content.length > maxLen ? content.slice(0, maxLen) + "\n\n... (完整报告保存在本地)" : content;
  const ok = await sendIM(`${emoji} ${title}\n\n${text}\n\n🤖 抖音视频投放管理系统`);
  return { ok };
}

// ====== Config ======
export function setFeishuChatId(chatId: string) { setSetting("feishuChatId", chatId); return { ok: true, chatId }; }
export function getFeishuConfig() { return { chatId: getChatId(), configured: true }; }
