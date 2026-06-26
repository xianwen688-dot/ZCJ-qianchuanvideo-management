import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, setSetting } from "./db";

// ====== lark-cli / cc-connect 路径 ======
const LARK_BIN = process.env.LARK_BIN || "lark-cli";
const CC_CONNECT_BIN = process.env.CC_CONNECT_BIN || "cc-connect";

interface LARK_CLI {
  profile: string;
  chatId: string;
}

function getConfig(): LARK_CLI {
  const getSetting = (key: string) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? "";
  };
  return {
    profile: process.env.LARK_PROFILE || getSetting("openClawProfile") || "zcjvideo",
    chatId: getSetting("feishuChatId") || "PLACEHOLDER",
  };
}

// ====== Run lark-cli command ======
function lark(args: string[], input?: string): { ok: boolean; output: string; error: string } {
  try {
    const cmd = `${LARK_BIN} ${args.join(" ")}`;
    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      input,
      env: { ...process.env },
      stdio: input ? ["pipe", "pipe", "pipe"] : undefined,
    });
    return { ok: true, output: (result as string).trim(), error: "" };
  } catch (err: any) {
    const stderr = err.stderr || String(err);
    return { ok: false, output: "", error: stderr.trim() };
  }
}

// ====== Create feishu doc from markdown ======
export function createFeishuDoc(title: string, content: string): { ok: boolean; url?: string; error?: string } {
  // Wrap title in XML tag per v2 API; use relative path (lark-cli requires it)
  const docContent = `<title>${title}</title>\n\n${content}`;
  const tmpDir = "reports/.tmp";
  fs.mkdirSync(tmpDir, { recursive: true });
  const relFile = `${tmpDir}/report_${Date.now()}.md`;
  fs.writeFileSync(relFile, docContent, "utf-8");

  try {
    const result = lark(
      ["docs", "+create", "--doc-format=markdown", "--as=bot", `--content=@./${relFile}`]
    );
    try { fs.unlinkSync(relFile); } catch { /* */ }

    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const urlMatch = result.output.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0] : result.output;
    return { ok: true, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { fs.unlinkSync(relFile); } catch { /* */ }
    return { ok: false, error: msg };
  }
}

// ====== Send IM notification ======
export function sendFeishuMessage(text: string): { ok: boolean; error?: string } {
  const config = getConfig();
  if (config.chatId === "PLACEHOLDER") {
    console.log("[feishu] 飞书群聊ID未配置，跳过IM推送");
    return { ok: false, error: "飞书群聊ID未配置" };
  }

  const result = lark([
    "im",
    "+messages-send",
    `--chat-id=${config.chatId}`,
    `--text=${JSON.stringify(text)}`,
    `--as=bot`,
  ]);

  if (!result.ok) {
    console.error("[feishu] IM推送失败:", result.error);
  }
  return result;
}

// ====== Push report: try doc first, fallback to IM text ======
export async function pushReport(title: string, content: string, reportType: string) {
  const config = getConfig();

  if (config.chatId === "PLACEHOLDER") {
    console.log("[feishu] 群聊ID未配置，仅保存本地");
    const localPath = path.resolve(process.cwd(), "reports", "local", `${reportType}_${Date.now()}.md`);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, content, "utf-8");
    return { ok: true, local: true, localPath, url: undefined };
  }

  // Try doc creation first
  const docResult = createFeishuDoc(title, content);

  if (docResult.ok && docResult.url) {
    const emoji = reportType === "daily" ? "📊" : reportType === "weekly" ? "📈" : "📋";
    const msgResult = sendFeishuMessage(`${emoji} ${title}\n📄 ${docResult.url}`);
    return { ok: true, url: docResult.url, imSent: msgResult.ok };
  }

  // Doc failed (e.g. no docx scope) → send full report as IM text directly
  console.log("[feishu] 文档创建失败，降级为IM直接推送:", docResult.error?.slice(0, 80));
  const emoji = reportType === "daily" ? "📊" : reportType === "weekly" ? "📈" : "📋";
  // Truncate content if too long (IM limit ~30KB)
  const maxLen = 25000;
  const text = content.length > maxLen
    ? content.slice(0, maxLen) + `\n\n... (内容过长已截断，完整报告保存在本地)`
    : content;
  const imResult = sendFeishuMessage(`${emoji} ${title}\n\n${text}`);
  if (imResult.ok) {
    return { ok: true, imOnly: true };
  }

  // Both doc and IM failed → save local
  fallbackLocally(title, content, docResult.error || imResult.error || "未知错误");
  return { ok: false, error: docResult.error || imResult.error };
}

// ====== Local fallback ======
function fallbackLocally(title: string, content: string, error: string) {
  const localDir = path.resolve(process.cwd(), "reports", "local");
  fs.mkdirSync(localDir, { recursive: true });
  const localPath = path.join(localDir, `report_${Date.now()}.md`);
  fs.writeFileSync(localPath, `# ${title}\n\n> ⚠️ 飞书推送失败: ${error}\n\n${content}`, "utf-8");
  console.log(`[feishu] 已保存本地报告: ${localPath}`);
}

// ====== Configure feishu chat ID ======
export function setFeishuChatId(chatId: string) {
  setSetting("feishuChatId", chatId);
  return { ok: true, chatId };
}

export function getFeishuConfig() {
  const config = getConfig();
  return {
    profile: config.profile,
    chatId: config.chatId,
    configured: config.chatId !== "PLACEHOLDER",
  };
}
