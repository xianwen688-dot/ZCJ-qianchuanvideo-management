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

// ====== Parse inline markdown → text_elements with styles ======
interface InlineResult { text: string; bold?: boolean }

function parseInline(text: string): InlineResult[] {
  const results: InlineResult[] = [];
  const re = /(\*\*(.+?)\*\*)|([^*]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      results.push({ text: m[2], bold: true });
    } else if (m[3]) {
      results.push({ text: m[3] });
    }
  }
  return results.length ? results : [{ text }];
}

function elements(text: string) {
  return parseInline(text).map((p) => ({
    text_run: { content: p.text, text_element_style: p.bold ? { bold: true } : {} },
  }));
}

// ====== Block builders ======
function h(level: number, text: string) {
  const key = level === 1 ? "heading1" : level === 2 ? "heading2" : "heading3";
  return { block_type: level + 2, [key]: { elements: elements(text), style: {} } };
}
function p(text: string) {
  return { block_type: 2, text: { elements: elements(text), style: {} } };
}
function bullet(text: string) {
  return { block_type: 12, bullet: { elements: elements(text), style: {} } };
}
function quote(text: string) {
  return { block_type: 14, quote: { elements: elements(text), style: {} } };
}

// ====== Format markdown tables as clean text ======
function formatTable(lines: string[]): string[] {
  // Parse table rows: skip separator line, align columns with padding
  const rows: string[][] = [];
  for (const line of lines) {
    if (/^\|[-:\s|]+\|$/.test(line)) continue;
    rows.push(line.split("|").slice(1, -1).map((c) => c.trim()));
  }
  if (rows.length < 2) return lines;

  // Calculate column widths
  const widths = rows[0].map((_, ci) => Math.max(...rows.map((r) => (r[ci] || "").replace(/\*\*/g, "").length)));

  const result: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c, ci) => c.padEnd(widths[ci] + 2, " "));
    result.push(cells.join("").trimEnd());
    if (i === 0) result.push("─".repeat(result[0].length + 4));
  }
  return result;
}

// ====== Create Feishu Doc from Markdown (with tables, bold, lists, quotes) ======
async function createFeishuDoc(title: string, content: string): Promise<string | null> {
  try {
    // Create empty doc
    const create = await api("POST", "/docx/v1/documents", { title });
    if (create.code !== 0) { console.error("[feishu] create doc:", create.msg); return null; }
    const docId = create.data.document.document_id;

    // Phase 1: Group table lines → formatted text, keep non-table lines as-is
    const rawLines = content.split("\n");
    const processedLines: string[] = [];
    let tableBuf: string[] = [];

    function flushTableBuf() {
      if (tableBuf.length >= 2) {
        processedLines.push(...formatTable(tableBuf));
      } else {
        processedLines.push(...tableBuf);
      }
      tableBuf = [];
    }

    for (const ln of rawLines) {
      const s = ln.trim();
      if (s.startsWith("|") && s.endsWith("|")) {
        tableBuf.push(s);
      } else {
        flushTableBuf();
        processedLines.push(ln);
      }
    }
    flushTableBuf();

    // Convert processed lines to blocks
    const blocks: any[] = [];
    for (const line of processedLines) {
      const s = line.trim();
      if (!s) continue;

      // Headings
      if (s.startsWith("# ") && !s.startsWith("## ")) {
        blocks.push(h(1, s.slice(2)));
      } else if (s.startsWith("## ")) {
        blocks.push(h(2, s.slice(3)));
      } else if (s.startsWith("### ")) {
        blocks.push(h(3, s.slice(4)));
      } else if (s === "---") {
        blocks.push(p("━━━━━━━━━━━━"));
      } else if (s.startsWith("> ")) {
        blocks.push(p("  " + s.slice(2)));
      } else if (/^[-*]\s/.test(s)) {
        blocks.push(p("· " + s.replace(/^[-*]\s*/, "")));
      } else {
        blocks.push(p(s));
      }
    }

    // Write blocks
    const BATCH = 40;
    let total = 0;
    for (let i = 0; i < blocks.length; i += BATCH) {
      const batch = blocks.slice(i, i + BATCH);
      const r = await api("POST", `/docx/v1/documents/${docId}/blocks/${docId}/children`, { children: batch, index: -1 });
      if (r.code === 0) total += batch.length;
      else console.error(`[feishu] write batch ${i}:`, r.msg, r.code);
    }
    console.log(`[feishu] doc ${docId}: ${total}/${blocks.length} blocks`);
    return `https://bytedance.feishu.cn/docx/${docId}`;
  } catch (err) {
    console.error("[feishu] doc error:", err);
    return null;
  }
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

export async function sendFeishuMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const ok = await sendIM(text);
  return ok ? { ok: true } : { ok: false, error: "发送失败" };
}

export async function pushReport(title: string, content: string, reportType: string) {
  const emoji = reportType === "daily" ? "📊" : reportType === "weekly" ? "📈" : "📋";
  const docUrl = await createFeishuDoc(title, content);
  if (docUrl) {
    const ok = await sendIM(`${emoji} ${title}\n📄 ${docUrl}\n\n🤖 抖音视频投放管理系统`);
    console.log(`[feishu] ${reportType} → ${docUrl}`);
    return { ok, url: docUrl };
  }
  const maxLen = 28000;
  const text = content.length > maxLen ? content.slice(0, maxLen) + "\n\n... (完整报告保存在本地)" : content;
  const ok = await sendIM(`${emoji} ${title}\n\n${text}\n\n🤖 抖音视频投放管理系统`);
  return { ok };
}

export function setFeishuChatId(chatId: string) { setSetting("feishuChatId", chatId); return { ok: true, chatId }; }
export function getFeishuConfig() { return { chatId: getChatId(), configured: true }; }
