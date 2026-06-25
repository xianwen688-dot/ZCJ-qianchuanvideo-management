import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSettings } from "./db";

const execFileAsync = promisify(execFile);

export interface AgentResult {
  ok: boolean;
  provider: "openclaw";
  content: string;
  raw?: string;
  error?: string;
}

function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function openClawProfile() {
  const settings = getSettings();
  return process.env.OPENCLAW_PROFILE || settings.openClawProfile || "zcjvideo";
}

function defaultOpenClawBin() {
  const scoopPath = "C:\\Users\\zhong\\scoop\\apps\\nodejs\\current\\bin\\openclaw.ps1";
  if (process.platform === "win32" && fs.existsSync(scoopPath)) return scoopPath;
  return "openclaw";
}

async function runOpenClaw(args: string[], timeoutMs = 90_000) {
  const configured = process.env.OPENCLAW_BIN || defaultOpenClawBin();
  const finalArgs = ["--profile", openClawProfile(), ...args];
  try {
    const result =
      process.platform === "win32" && configured.toLowerCase().endsWith(".ps1")
        ? await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", configured, ...finalArgs], {
            timeout: timeoutMs,
            maxBuffer: 20 * 1024 * 1024
          })
        : await execFileAsync(configured, finalArgs, {
            timeout: timeoutMs,
            maxBuffer: 20 * 1024 * 1024
          });
    return {
      stdout: stripAnsi(result.stdout ?? ""),
      stderr: stripAnsi(result.stderr ?? "")
    };
  } catch (error) {
    const details = error as Error & { stdout?: string; stderr?: string; code?: string | number };
    const stderr = stripAnsi(details.stderr ?? "");
    const stdout = stripAnsi(details.stdout ?? "");
    const message = [details.message, stderr, stdout].filter(Boolean).join("\n").slice(0, 2000);
    throw new Error(normalizeOpenClawError(message));
  }
}

function normalizeOpenClawError(message: string) {
  if (/EPERM|permission|access is denied|拒绝访问/i.test(message)) {
    return `OpenClaw 权限不足，服务进程无法访问 OpenClaw 状态目录或模型网关。原始错误：${message}`;
  }
  if (/auth|gateway|unauthorized|forbidden|token|login/i.test(message)) {
    return `OpenClaw 未完成授权或网关不可用。原始错误：${message}`;
  }
  if (/provider|model|not configured|not found/i.test(message)) {
    return `OpenClaw provider/model 未配置或不可用。原始错误：${message}`;
  }
  return `OpenClaw 调用失败：${message}`;
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstObject = trimmed.indexOf("{");
    const lastObject = trimmed.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(trimmed.slice(firstObject, lastObject + 1));
      } catch {
        // fall through
      }
    }
    const firstArray = trimmed.indexOf("[");
    const lastArray = trimmed.lastIndexOf("]");
    if (firstArray >= 0 && lastArray > firstArray) {
      try {
        return JSON.parse(trimmed.slice(firstArray, lastArray + 1));
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function collectText(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = ["text", "content", "description", "markdown", "title", "summary", "result", "output", "body"];
    return preferred.flatMap((key) => collectText(record[key], depth + 1));
  }
  return [];
}

function normalizeAgentOutput(stdout: string, stderr: string): AgentResult {
  const parsed = extractJsonPayload(stdout);
  const content = collectText(parsed).join("\n").trim() || stdout.trim();
  if (!content) {
    return {
      ok: false,
      provider: "openclaw",
      content: "",
      raw: [stdout, stderr].filter(Boolean).join("\n").slice(0, 4000),
      error: "OpenClaw 返回为空，未读取到可用内容。"
    };
  }
  return {
    ok: true,
    provider: "openclaw",
    content: content.slice(0, 12000),
    raw: [stdout, stderr].filter(Boolean).join("\n").slice(0, 4000)
  };
}

export async function describeImageWithAgent(filePath: string): Promise<AgentResult> {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    return {
      ok: false,
      provider: "openclaw",
      content: "",
      error: `图片路径不存在或不可读：${absolute}`
    };
  }
  try {
    const { stdout, stderr } = await runOpenClaw(["capability", "image", "describe", "--file", absolute, "--json"], 120_000);
    return normalizeAgentOutput(stdout, stderr);
  } catch (error) {
    return {
      ok: false,
      provider: "openclaw",
      content: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function fetchWebTextWithAgent(url: string): Promise<AgentResult> {
  try {
    const { stdout, stderr } = await runOpenClaw(["capability", "web", "fetch", "--url", url, "--json"], 90_000);
    return normalizeAgentOutput(stdout, stderr);
  } catch (error) {
    return {
      ok: false,
      provider: "openclaw",
      content: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function testAgent(): Promise<AgentResult> {
  try {
    const { stdout, stderr } = await runOpenClaw(["capability", "list", "--json"], 30_000);
    return normalizeAgentOutput(stdout, stderr);
  } catch (error) {
    return {
      ok: false,
      provider: "openclaw",
      content: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
