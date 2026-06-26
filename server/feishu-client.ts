import fs from "node:fs";
import path from "node:path";
import { db, setSetting } from "./db";

const BOT_APP_ID = process.env.FEISHU_APP_ID || "";
const BOT_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const FEISHU_API = "https://open.feishu.cn/open-apis";

let cachedToken = "";
let tokenExpiry = 0;

// ====== Get tenant access token (cached) ======
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  try {
    const r = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: BOT_APP_ID, app_secret: BOT_APP_SECRET }),
    });
    const data = await r.json() as any;
    cachedToken = data.tenant_access_token || "";
    tokenExpiry = Date.now() + (data.expire || 7200) * 1000;
    return cachedToken;
  } catch (err) {
    console.error("[feishu] token错误:", err);
    return "";
  }
}

// ====== Get chat ID from settings ======
function getChatId(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'feishuChatId'").get() as { value: string } | undefined;
  return row?.value || "oc_247ba5bf8af048ba1bd402ede971935e";
}

// ====== Send IM message via Feishu OpenAPI ======
export async function sendFeishuMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken();
  if (!token) return { ok: false, error: "无法获取飞书token" };
  const chatId = getChatId();
  try {
    const r = await fetch(
      `${FEISHU_API}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
      }
    );
    const data = await r.json() as any;
    if (data.code === 0) return { ok: true };
    return { ok: false, error: data.msg || `code=${data.code}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ====== Push report to feishu group chat ======
export async function pushReport(title: string, content: string, reportType: string) {
  const emoji = reportType === "daily" ? "📊" : reportType === "weekly" ? "📈" : "📋";
  const maxLen = 28000;
  const text = content.length > maxLen
    ? content.slice(0, maxLen) + `\n\n... (完整报告保存在本地)`
    : content;
  const textWithTitle = `${emoji} ${title}\n\n${text}\n\n---\n🤖 抖音视频投放管理系统`;

  const result = await sendFeishuMessage(textWithTitle);
  if (result.ok) {
    console.log(`[feishu] ${reportType}报告已推送`);
  } else {
    console.error(`[feishu] 推送失败:`, result.error);
    const localDir = path.resolve(process.cwd(), "reports", "local");
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, `report_${Date.now()}.md`), content, "utf-8");
  }
  return result;
}

// ====== Configure ======
export function setFeishuChatId(chatId: string) {
  setSetting("feishuChatId", chatId);
  return { ok: true, chatId };
}

export function getFeishuConfig() {
  return { chatId: getChatId(), configured: true };
}
