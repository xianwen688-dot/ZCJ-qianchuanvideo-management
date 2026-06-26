import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, setSetting } from "./db";

const LARK_BIN = "lark-cli";

function getChatId(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'feishuChatId'").get() as { value: string } | undefined;
  return row?.value || "oc_247ba5bf8af048ba1bd402ede971935e";
}

// ====== Create feishu doc from markdown (via lark-cli, which handles tables natively) ======
function createFeishuDoc(title: string, content: string): { ok: boolean; url?: string } {
  // Write full markdown to temp file
  const tmpDir = "reports/.tmp";
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = `reports/.tmp/import_${Date.now()}.md`;
  fs.writeFileSync(tmpFile, content, "utf-8");

  try {
    // lark-cli natively converts markdown tables/bold/headings to docx
    const result = execSync(
      `${LARK_BIN} docs +create --api-version v2 --doc-format markdown --as bot --content=@./${tmpFile}`,
      {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      }
    );
    try { fs.unlinkSync(tmpFile); } catch { /* */ }

    const data = JSON.parse(result);
    if (data.ok) {
      const url = data.data?.document?.url || `https://bytedance.feishu.cn/docx/${data.data?.document?.document_id}`;
      console.log(`[feishu] doc created: ${url}`);
      return { ok: true, url };
    }
    console.error("[feishu] lark-cli doc create failed:", JSON.stringify(data.error).slice(0, 200));
    return { ok: false };
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }
    console.error("[feishu] lark-cli error:", String(err).slice(0, 200));
    return { ok: false };
  }
}

// ====== Send IM via OpenAPI (fast, reliable) ======
let cachedToken = "";
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID || "", app_secret: process.env.FEISHU_APP_SECRET || "" }),
  });
  const data = await r.json() as any;
  cachedToken = data.tenant_access_token || "";
  tokenExpiry = Date.now() + (data.expire || 7200) * 1000;
  return cachedToken;
}

async function sendIM(text: string): Promise<boolean> {
  try {
    const token = await getToken();
    const r = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ receive_id: getChatId(), msg_type: "text", content: JSON.stringify({ text }) }),
    });
    const data = await r.json() as any;
    return data.code === 0;
  } catch { return false; }
}

export async function sendFeishuMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const ok = await sendIM(text);
  return ok ? { ok: true } : { ok: false, error: "发送失败" };
}

// ====== Push report: create doc + send link ======
export async function pushReport(title: string, content: string, reportType: string) {
  const emoji = reportType === "daily" ? "📊" : reportType === "weekly" ? "📈" : "📋";

  // Step 1: Create feishu doc via lark-cli (native markdown→docx with tables)
  const docResult = createFeishuDoc(title, content);

  if (docResult.ok && docResult.url) {
    // Step 2: Send doc link to group via OpenAPI
    const ok = await sendIM(`${emoji} ${title}\n📄 ${docResult.url}\n\n🤖 抖音视频投放管理系统`);
    console.log(`[feishu] ${reportType} → ${docResult.url}`);
    return { ok, url: docResult.url };
  }

  // Fallback: send full text via IM
  console.log("[feishu] 文档创建失败，降级为文本推送");
  const maxLen = 28000;
  const text = content.length > maxLen ? content.slice(0, maxLen) + "\n\n... (完整报告保存在本地)" : content;
  const ok = await sendIM(`${emoji} ${title}\n\n${text}\n\n🤖 抖音视频投放管理系统`);
  return { ok };
}

export function setFeishuChatId(chatId: string) { setSetting("feishuChatId", chatId); return { ok: true, chatId }; }
export function getFeishuConfig() { return { chatId: getChatId(), configured: true }; }
