import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, setSetting } from "./db";

// ====== lark-cli 路径 ======
const LARK_BIN = process.env.LARK_BIN || "lark-cli";

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
  const config = getConfig();

  // Write to temp file (lark-cli reads content from stdin or file)
  const tmpDir = path.resolve(process.cwd(), "reports", ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `report_${Date.now()}.md`);
  fs.writeFileSync(tmpFile, content, "utf-8");

  try {
    const result = lark(
      [
        "docs",
        "+create",
        `--title=${JSON.stringify(title)}`,
        "--doc-format=markdown",
        `--as=${config.profile}`,
        `--content=@${tmpFile}`,
      ],
    );

    // Cleanup temp file
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

    if (!result.ok) {
      // Fallback: keep local file and report error
      fallbackLocally(title, content, result.error);
      return { ok: false, error: result.error };
    }

    // Extract doc URL from lark-cli output
    const urlMatch = result.output.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0] : result.output;
    return { ok: true, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fallbackLocally(title, content, msg);
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
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
    `--as=${config.profile}`,
  ]);

  if (!result.ok) {
    console.error("[feishu] IM推送失败:", result.error);
  }
  return result;
}

// ====== Push report: doc + IM notification ======
export async function pushReport(title: string, content: string, reportType: string) {
  const config = getConfig();

  if (config.chatId === "PLACEHOLDER") {
    // No feishu config yet → save locally only
    console.log("[feishu] 飞书未配置，仅保存本地报告");
    const localPath = path.resolve(process.cwd(), "reports", "local", `${reportType}_${Date.now()}.md`);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, content, "utf-8");
    return { ok: true, local: true, localPath, url: undefined };
  }

  const docResult = createFeishuDoc(title, content);

  if (docResult.ok && docResult.url) {
    // Notify IM
    const emoji = reportType === "daily" ? "📊" : reportType === "weekly" ? "📈" : "📋";
    const msg = `${emoji} ${title}\n${docResult.url}`;
    const msgResult = sendFeishuMessage(msg);
    return { ok: true, url: docResult.url, imSent: msgResult.ok };
  }

  return { ok: false, error: docResult.error };
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
