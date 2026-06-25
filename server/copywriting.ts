import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { db, getSettings } from "./db";
import { callChatCompletions, MINIMAX_BASE_URL, MINIMAX_MODEL } from "./aiProvider";
import { fetchWebTextWithAgent } from "./agentAdapter";

const uploadDir = path.resolve(process.cwd(), "data", "copywriting_uploads");
fs.mkdirSync(uploadDir, { recursive: true });

export const copywritingUploadDir = uploadDir;

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

const lowValueSourcePatterns = [
  /douyin\.com\/jingxuan\/search/i,
  /抖音搜索|搜索结果|综合排序/,
  /captcha|verify|login|登录|安全验证|验证码/i,
  /enable javascript|please enable/i
];

type CopyProjectRow = {
  id: number;
  source_url: string;
  source_title: string;
  source_excerpt: string;
  product_name: string;
  platform: string;
  requirements: string;
};

export function isAllowedCopyAsset(file: { mimetype: string; originalname: string }) {
  const ext = path.extname(file.originalname).toLowerCase();
  return allowedMimeTypes.has(file.mimetype) || [".txt", ".docx", ".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
}

function now() {
  return new Date().toISOString();
}

function cleanText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)?.[1] ??
    "";
  return {
    title: cleanText(title).slice(0, 180),
    excerpt: cleanText(`${description} ${html}`).slice(0, 8000)
  };
}

function sourceQuality(input: { sourceUrl?: string; sourceExcerpt?: string; assetText?: string }) {
  const source = cleanText(input.sourceExcerpt ?? "");
  const asset = cleanText(input.assetText ?? "");
  const usefulAsset = asset.replace(/图片参考：[^。]+。图片已保存，但尚未识别图片内容。/g, "").trim();
  const lowValue = lowValueSourcePatterns.some((pattern) => pattern.test(source));
  const hasSource = source.length >= 40 && !lowValue;
  const hasAsset = usefulAsset.length >= 40;
  return {
    ok: hasSource || hasAsset,
    hasSource,
    hasAsset,
    lowValue,
    referenceLength: Math.max(source.length, usefulAsset.length),
    label: hasSource ? "已读取参考链接内容" : hasAsset ? "已读取本地/粘贴参考" : "参考内容不足"
  };
}

function riskReview(text: string) {
  const risky = [
    ["根治", "改善"],
    ["治愈", "帮助缓解"],
    ["永久", "长期维护"],
    ["最有效", "更适合"],
    ["第一", "表现突出"],
    ["立刻消失", "逐步改善"],
    ["神药", "护理方案"],
    ["包好", "持续护理"]
  ];
  const hits = risky.filter(([word]) => text.includes(word)).map(([word, replacement]) => ({ word, replacement }));
  return {
    riskLevel: hits.length >= 3 ? "high" : hits.length ? "medium" : "low",
    bannedWords: hits,
    notes: hits.length
      ? "发现可能影响千川投流审核的绝对化或功效承诺表达，建议使用更稳妥的体验型表达。"
      : "未发现明显高风险词，上线前仍建议结合平台最新审核反馈复核。"
  };
}

function topMaterialContext() {
  const rows = db
    .prepare(
      `SELECT material_name, platform,
              COALESCE(gross_gmv, net_gmv, paid_amount, 0) AS gmv,
              COALESCE(spend, 0) AS spend,
              COALESCE(net_roi, paid_roi, CASE WHEN COALESCE(spend, 0) > 0 THEN COALESCE(gross_gmv, net_gmv, paid_amount, 0) / COALESCE(spend, 0) ELSE 0 END, 0) AS roi
       FROM material_metrics
       ORDER BY gmv DESC, roi DESC
       LIMIT 5`
    )
    .all() as Array<{ material_name: string; platform: string; gmv: number; spend: number; roi: number }>;
  return rows.map((row) => `${row.platform}: ${row.material_name} GMV ${row.gmv} ROI ${Number(row.roi ?? 0).toFixed(2)}`).join("\n");
}

export function createCopyProject(input: {
  sourceUrl?: string;
  productName: string;
  platform?: string;
  requirements?: string;
  referenceText?: string;
  createdByRole?: string;
}) {
  const timestamp = now();
  const referenceText = cleanText(input.referenceText ?? "").slice(0, 12000);
  const result = db
    .prepare(
      `INSERT INTO copy_projects
       (source_url, source_title, source_excerpt, source_status, source_error, product_name, platform, requirements, status, created_by_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sourceUrl?.trim() ?? "",
      referenceText ? "用户粘贴参考文案" : "",
      referenceText,
      referenceText ? "manual" : "empty",
      input.productName.trim(),
      input.platform?.trim() ?? "",
      input.requirements?.trim() ?? "",
      referenceText ? "ready" : "draft",
      input.createdByRole ?? "viewer",
      timestamp,
      timestamp
    );
  return getCopyProject(Number(result.lastInsertRowid));
}

export function listCopyProjects(limit = 30) {
  return db.prepare("SELECT * FROM copy_projects ORDER BY updated_at DESC, id DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 100));
}

export function getCopyProject(id: number) {
  const project = db.prepare("SELECT * FROM copy_projects WHERE id = ?").get(id);
  if (!project) return null;
  const assets = db.prepare("SELECT * FROM copy_assets WHERE project_id = ? ORDER BY created_at DESC, id DESC").all(id);
  const outputs = db.prepare("SELECT * FROM copy_outputs WHERE project_id = ? ORDER BY created_at DESC, id DESC").all(id);
  return { project, assets, outputs };
}

function isDynamicSource(url: string) {
  return /douyin\.com|tmall\.com|taobao\.com/i.test(url) && (/jingxuan\/search|modal_id=|video|item/i.test(url));
}

async function fetchWithOpenClaw(projectId: number, sourceUrl: string) {
  db.prepare("UPDATE copy_projects SET source_status = 'fetching', source_error = '', updated_at = ? WHERE id = ?").run(now(), projectId);
  const agent = await fetchWebTextWithAgent(sourceUrl);
  const excerpt = cleanText(agent.content || "").slice(0, 8000);
  const quality = sourceQuality({ sourceUrl, sourceExcerpt: excerpt });
  if (agent.ok && quality.hasSource) {
    db.prepare(
      `UPDATE copy_projects
       SET source_title = ?, source_excerpt = ?, source_status = 'fetched', source_error = '', status = 'ready', updated_at = ?
       WHERE id = ?`
    ).run("OpenClaw 网页读取", excerpt, now(), projectId);
    return getCopyProject(projectId);
  }
  const message = [
    "OpenClaw 没有读取到可用于仿写的视频文案。",
    "如果页面需要登录、验证码或存在反爬限制，系统不会绕过平台限制。",
    "请上传截图、txt/docx，或把视频标题/口播文案粘贴到参考文案区域后再生成。",
    agent.error ? `OpenClaw 原因：${agent.error}` : "OpenClaw 返回为空。"
  ].join(" ");
  db.prepare("UPDATE copy_projects SET source_status = 'failed', source_error = ?, updated_at = ? WHERE id = ?").run(message, now(), projectId);
  throw new Error(message);
}

export async function fetchCopySource(projectId: number) {
  const row = db.prepare("SELECT * FROM copy_projects WHERE id = ?").get(projectId) as { source_url?: string } | undefined;
  if (!row) throw new Error("仿写项目不存在。");
  if (!row.source_url) throw new Error("请先填写爆款链接，或直接粘贴参考文案。");

  let parsed: URL;
  try {
    parsed = new URL(row.source_url);
  } catch {
    throw new Error("链接格式不正确。");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("仅支持 http/https 链接。");

  if (isDynamicSource(parsed.toString())) {
    return fetchWithOpenClaw(projectId, parsed.toString());
  }

  db.prepare("UPDATE copy_projects SET source_status = 'fetching', source_error = '', updated_at = ? WHERE id = ?").run(now(), projectId);
  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 ZCJVideoOps/1.0",
        Accept: "text/html,text/plain,application/json"
      },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error(`抓取失败：HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const extracted = contentType.includes("html") ? htmlToText(text) : { title: parsed.hostname, excerpt: cleanText(text).slice(0, 8000) };
    const quality = sourceQuality({ sourceUrl: parsed.toString(), sourceExcerpt: extracted.excerpt });
    if (!quality.hasSource) return fetchWithOpenClaw(projectId, parsed.toString());
    db.prepare(
      `UPDATE copy_projects
       SET source_title = ?, source_excerpt = ?, source_status = 'fetched', source_error = '', status = 'ready', updated_at = ?
       WHERE id = ?`
    ).run(extracted.title || parsed.hostname, extracted.excerpt, now(), projectId);
  } catch (error) {
    try {
      return await fetchWithOpenClaw(projectId, parsed.toString());
    } catch (agentError) {
      const message = agentError instanceof Error ? agentError.message : String(agentError);
      db.prepare("UPDATE copy_projects SET source_status = 'failed', source_error = ?, updated_at = ? WHERE id = ?").run(message, now(), projectId);
      throw error instanceof Error ? new Error(`${error.message}；${message}`) : new Error(message);
    }
  }
  return getCopyProject(projectId);
}

export async function addCopyAsset(projectId: number, file: { originalname: string; path: string; filename: string; mimetype: string; size: number }) {
  if (!isAllowedCopyAsset(file)) throw new Error("仅支持图片、txt、docx 文件。");
  const ext = path.extname(file.originalname).toLowerCase();
  let extracted = "";
  if (ext === ".txt") {
    extracted = fs.readFileSync(file.path, "utf8").slice(0, 12000);
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: file.path });
    extracted = result.value.slice(0, 12000);
  } else if (file.mimetype.startsWith("image/")) {
    extracted = `图片参考：${file.originalname}。图片已保存，但尚未识别图片内容。`;
  }
  db.prepare(
    `INSERT INTO copy_assets
     (project_id, file_name, path, mime_type, size, extracted_text, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'stored', '', ?)`
  ).run(projectId, file.originalname, file.path, file.mimetype, file.size, extracted, now());
  db.prepare("UPDATE copy_projects SET updated_at = ? WHERE id = ?").run(now(), projectId);
  return getCopyProject(projectId);
}

async function ensureReference(projectId: number) {
  let project = db.prepare("SELECT * FROM copy_projects WHERE id = ?").get(projectId) as CopyProjectRow | undefined;
  if (!project) throw new Error("仿写项目不存在。");

  const assets = db.prepare("SELECT extracted_text FROM copy_assets WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Array<{
    extracted_text: string;
  }>;
  let assetText = assets.map((asset) => asset.extracted_text).filter(Boolean).join("\n\n").slice(0, 12000);
  let quality = sourceQuality({ sourceUrl: project.source_url, sourceExcerpt: project.source_excerpt, assetText });

  if (!quality.ok && project.source_url) {
    await fetchCopySource(projectId);
    project = db.prepare("SELECT * FROM copy_projects WHERE id = ?").get(projectId) as CopyProjectRow | undefined;
    if (!project) throw new Error("仿写项目不存在。");
    const nextAssets = db.prepare("SELECT extracted_text FROM copy_assets WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Array<{
      extracted_text: string;
    }>;
    assetText = nextAssets.map((asset) => asset.extracted_text).filter(Boolean).join("\n\n").slice(0, 12000);
    quality = sourceQuality({ sourceUrl: project.source_url, sourceExcerpt: project.source_excerpt, assetText });
  }

  if (!quality.ok) {
    const message = "未读取到参考视频内容，未调用 MiniMax。请粘贴视频标题/口播文案，或上传可解析的 txt/docx 后再生成。";
    db.prepare("UPDATE copy_projects SET status = 'failed', source_error = ?, updated_at = ? WHERE id = ?").run(message, now(), projectId);
    throw new Error(message);
  }
  return { project, assetText, quality };
}

export async function generateCopyOutput(projectId: number, jobId?: number) {
  const { project, assetText, quality } = await ensureReference(projectId);
  const settings = getSettings();
  if (!settings.aiApiKey) throw new Error("尚未配置 MiniMax API Key，未调用 MiniMax。");

  let scriptText = "";
  let provider = settings.aiBaseUrl || MINIMAX_BASE_URL;
  let usedAi = 0;
  let aiError = "";
  try {
    scriptText = await callChatCompletions({
      model: settings.aiTextModel || MINIMAX_MODEL,
      apiKey: settings.aiApiKey,
      baseUrl: settings.aiBaseUrl || MINIMAX_BASE_URL,
      maxTokens: 2600,
      thinking: "adaptive",
      messages: [
        {
          role: "system",
          content:
            "你是电商短视频千川投流脚本改编 agent。必须基于用户提供的参考内容拆解结构，再为目标产品生成可直接拍摄的中文脚本。禁止编造参考视频里没有的信息，禁止绝对化、医疗功效承诺和夸大表达。"
        },
        {
          role: "user",
          content: [
            `仿写产品：${project.product_name}`,
            `平台/投流口径：${project.platform || "默认千川投流"}`,
            `用户要求：${project.requirements || "无，默认输出可投流脚本"}`,
            `爆款链接：${project.source_url || "无"}`,
            `参考链接/粘贴内容：${project.source_excerpt || "未抓取到可用内容"}`,
            `本地上传参考：${assetText || "无"}`,
            `本地高成交素材摘要：${topMaterialContext() || "暂无"}`,
            [
              "请按以下结构输出：",
              "1. 参考内容拆解：爆点、开头钩子、人群痛点、信任证据、转化动作。",
              "2. 仿写脚本正文：按 0-3 秒、3-18 秒、18-30 秒分段，给出可直接口播/字幕内容。",
              "3. 镜头/画面建议：每段对应拍摄画面。",
              "4. 千川合规替换建议：列出风险词和更稳妥表达。",
              "5. 最终可复制版本：只保留可直接使用的脚本文案。"
            ].join("\n")
          ].join("\n\n")
        }
      ]
    });
    usedAi = 1;
  } catch (error) {
    aiError = error instanceof Error ? error.message : String(error);
    db.prepare("UPDATE copy_projects SET status = 'failed', source_error = ?, updated_at = ? WHERE id = ?").run(aiError, now(), projectId);
    throw error;
  }

  const compliance = { ...riskReview(scriptText), sourceQuality: quality, aiError, referenceLength: quality.referenceLength };
  const result = db
    .prepare(
      `INSERT INTO copy_outputs
       (project_id, job_id, provider, used_ai, script_text, compliance_json, export_file_name, ai_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, jobId ?? null, provider, usedAi, scriptText, JSON.stringify(compliance), `${project.product_name || "copywriting"}-${Date.now()}.docx`, aiError, now());
  db.prepare("UPDATE copy_projects SET status = 'generated', source_error = '', updated_at = ? WHERE id = ?").run(now(), projectId);
  return db.prepare("SELECT * FROM copy_outputs WHERE id = ?").get(result.lastInsertRowid);
}

export async function buildCopyDocx(projectId: number) {
  const bundle = getCopyProject(projectId) as
    | {
        project: { product_name: string; source_url: string; requirements: string };
        outputs: Array<{ script_text: string; compliance_json: string; created_at: string }>;
      }
    | null;
  if (!bundle || !bundle.outputs.length) throw new Error("暂无可导出的仿写结果。");
  const output = bundle.outputs[0];
  const compliance = JSON.parse(output.compliance_json || "{}") as { riskLevel?: string; notes?: string };
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "爆款仿写脚本", heading: HeadingLevel.TITLE }),
          new Paragraph(`产品：${bundle.project.product_name}`),
          new Paragraph(`来源：${bundle.project.source_url || "本地素材/用户输入"}`),
          new Paragraph(`要求：${bundle.project.requirements || "默认输出可投放脚本"}`),
          new Paragraph({ text: "脚本正文", heading: HeadingLevel.HEADING_1 }),
          ...output.script_text.split(/\r?\n/).map((line) => new Paragraph({ children: [new TextRun(line || " ")] })),
          new Paragraph({ text: "合规提醒", heading: HeadingLevel.HEADING_1 }),
          new Paragraph(`风险等级：${compliance.riskLevel ?? "low"}`),
          new Paragraph(compliance.notes ?? "")
        ]
      }
    ]
  });
  return Packer.toBuffer(doc);
}

export function deleteCopyProject(id: number) {
  const assets = db.prepare("SELECT path FROM copy_assets WHERE project_id = ?").all(id) as Array<{ path: string }>;
  for (const asset of assets) {
    try {
      if (asset.path.startsWith(uploadDir) && fs.existsSync(asset.path)) fs.unlinkSync(asset.path);
    } catch {
      // best effort cleanup
    }
  }
  db.prepare("DELETE FROM copy_projects WHERE id = ?").run(id);
}
