export const MINIMAX_BASE_URL = "https://api.minimax.io/v1";
export const MINIMAX_MODEL = "MiniMax-M3";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export type ChatCompletionInput = {
  model: string;
  apiKey: string;
  baseUrl: string;
  messages: ChatMessage[];
  maxTokens?: number;
  thinking?: "adaptive" | "disabled";
  timeoutMs?: number;
};

function normalizeBaseUrl(baseUrl: string) {
  return (baseUrl || MINIMAX_BASE_URL).replace(/\/$/, "");
}

function isMiniMax(baseUrl: string, model: string) {
  return normalizeBaseUrl(baseUrl).includes("minimax") || model === MINIMAX_MODEL;
}

function cleanModelOutput(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function parseAiError(status: number, text: string, miniMax: boolean) {
  const lower = text.toLowerCase();
  if (miniMax) {
    if (lower.includes("invalid api key") || text.includes("2049") || status === 401) {
      return "MiniMax API Key 无效或区域不匹配，请检查 Key、Base URL 和模型权限。";
    }
    if (lower.includes("usage limit exceeded") || text.includes("2056") || lower.includes("insufficient")) {
      return "MiniMax 额度不足或当前 Key 未开通可用额度，请在 MiniMax 控制台确认后重试。";
    }
    if (lower.includes("model") && (lower.includes("not") || lower.includes("permission"))) {
      return "当前 MiniMax Key 没有 MiniMax-M3 模型权限，请在控制台确认模型开通状态。";
    }
  }
  return `AI 请求失败：HTTP ${status} ${text.slice(0, 500)}`;
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = [
      "content",
      "text",
      "output_text",
      "response",
      "result",
      "answer",
      "reasoning_content",
      "delta",
      "message"
    ];
    return keys.flatMap((key) => collectStrings(record[key], depth + 1));
  }
  return [];
}

export function summarizeAiResponse(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return String(value).slice(0, 800);
  }
}

function extractCompletionContent(json: unknown) {
  const record = json as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    const content = collectStrings(choice).map(cleanModelOutput).filter(Boolean).join("\n").trim();
    if (content) return content;
  }
  const fallback = collectStrings(json).map(cleanModelOutput).filter(Boolean).join("\n").trim();
  return fallback;
}

export async function callChatCompletions(input: ChatCompletionInput) {
  if (!input.apiKey) throw new Error("尚未配置 AI API Key。");

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = input.model || MINIMAX_MODEL;
  const miniMax = isMiniMax(baseUrl, model);
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    temperature: 0.3,
    max_completion_tokens: input.maxTokens ?? 1600
  };

  if (miniMax && model === MINIMAX_MODEL) {
    body.thinking = { type: input.thinking ?? "adaptive" };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 120_000)
    });
  } catch (error) {
    throw new Error(`AI 请求连接失败：${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(parseAiError(response.status, text, miniMax));
  }

  const json = await response.json();
  const content = cleanModelOutput(extractCompletionContent(json));
  if (!content) {
    throw new Error(`AI 返回内容为空。原始响应摘要：${summarizeAiResponse(json)}`);
  }
  return content;
}

export async function testAiConnection(input: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}) {
  const content = await callChatCompletions({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl || MINIMAX_BASE_URL,
    model: input.model || MINIMAX_MODEL,
    maxTokens: 200,
    thinking: "disabled",
    timeoutMs: 30_000,
    messages: [
      { role: "system", content: "你是接口连通性测试助手，只输出简短中文。" },
      { role: "user", content: "请回复：MiniMax-M3 已连通。" }
    ]
  });
  return { ok: true, model: input.model || MINIMAX_MODEL, baseUrl: input.baseUrl || MINIMAX_BASE_URL, content };
}
