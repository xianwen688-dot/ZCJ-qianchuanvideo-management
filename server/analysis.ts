import fs from "node:fs";
import { db, getSettings } from "./db";
import { callChatCompletions, MINIMAX_BASE_URL, MINIMAX_MODEL } from "./aiProvider";
import { describeImageWithAgent } from "./agentAdapter";

interface MaterialRow {
  id: number;
  platform: string;
  material_name: string;
  material_id: string;
  net_roi: number | null;
  net_gmv: number | null;
  net_orders: number | null;
  clicks: number | null;
  conversion_rate: number | null;
  spend: number | null;
  click_rate: number | null;
  gross_gmv: number | null;
  gross_orders: number | null;
  three_second_rate: number | null;
  plays: number | null;
  completion_rate: number | null;
  paid_roi: number | null;
  avg_watch_seconds: number | null;
  order_cost: number | null;
}

interface ScriptRow {
  id: number;
  file_name: string;
  product: string;
  scene: string;
  script_text: string;
  segments_json: string;
}

function money(value: number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function pct(value: number | null | undefined) {
  return `${((value ?? 0) * 100).toFixed(2)}%`;
}

function buildRuleInsight(material: MaterialRow, script?: ScriptRow) {
  const spend = material.spend ?? 0;
  const gmv = material.gross_gmv ?? material.net_gmv ?? 0;
  const roi = material.net_roi ?? material.paid_roi ?? (spend > 0 ? gmv / spend : 0);
  const ctr = material.click_rate ?? 0;
  const cvr = material.conversion_rate ?? 0;
  const complete = material.completion_rate ?? 0;
  const threeSecond = material.three_second_rate ?? 0;
  const scriptText = script?.script_text ?? "";
  const firstLine = scriptText.split(/\r?\n/).find(Boolean) ?? "";
  const hasBenefit = /福利|羊毛|领券|买一|到手|活动|618|优惠/.test(scriptText);
  const hasCta = /下单|点击|直播间|去拍|入手|安排|囤|试试|马上/.test(scriptText);
  const hasProblem = /痘|闭口|出油|敏感|泛红|粉刺|熬夜|反复/.test(scriptText);
  const riskWords = ["根治", "治愈", "最有效", "第一", "永久", "神药", "立刻消失", "包好"].filter((word) => scriptText.includes(word));

  const score = {
    roi,
    spend,
    gmv,
    ctr,
    cvr,
    complete,
    threeSecond,
    scriptCompleteness: scriptText.length > 80 ? 1 : scriptText.length > 0 ? 0.5 : 0,
    riskCount: riskWords.length
  };

  const suggestions: string[] = [];
  if (spend > 100 && roi < 1) suggestions.push("投产偏低：先不要单纯加预算，优先重剪开头 3 秒和成交钩子，再小预算复测。");
  if (ctr < 0.03 && spend > 50) suggestions.push("点击率偏低：封面/首屏卖点需要更直接，把核心痛点和结果承诺前置。");
  if (threeSecond < 0.35 && material.plays && material.plays > 1000) suggestions.push("3 秒留存偏弱：开头避免铺垫，第一句话直接点出人群、痛点或福利。");
  if (complete < 0.05 && material.plays && material.plays > 1000) suggestions.push("完播率偏低：中段压缩成“痛点-证据-场景-转化理由”四段。");
  if (!hasProblem && scriptText) suggestions.push("脚本痛点不够明显：补充油痘肌、闭口、反复长痘等具体场景。");
  if (!hasBenefit && scriptText) suggestions.push("转化利益点不足：加入到手价、赠品、活动期限或直播间福利。");
  if (!hasCta && scriptText) suggestions.push("CTA 不够明确：结尾给出“去领券/直播间拍/先囤一支”等行动指令。");
  if (riskWords.length) suggestions.push(`合规风险：出现 ${riskWords.join("、")}，建议改成更稳妥的体验型表达。`);
  if (!suggestions.length) suggestions.push("当前素材数据和脚本结构较完整，建议复制高 ROI 素材的开头钩子和成交表达做 A/B 版本。");

  const content = [
    `数据诊断：消耗 ${money(spend)}，成交 ${money(gmv)}，ROI ${roi.toFixed(2)}，点击率 ${pct(ctr)}，转化率 ${pct(cvr)}，3 秒播放率 ${pct(threeSecond)}，完播率 ${pct(complete)}。`,
    script
      ? `脚本判断：脚本文件为《${script.file_name}》。开头句是“${firstLine.slice(0, 80)}”，当前脚本${hasProblem ? "有痛点" : "痛点偏弱"}，${hasBenefit ? "有福利点" : "福利点偏弱"}，${hasCta ? "有行动指令" : "行动指令偏弱"}。`
      : "脚本判断：当前素材还没有匹配到脚本，建议先在素材列表中确认匹配关系。",
    `优化建议：\n${suggestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    "改写方向：第一句先锁定人群和痛点，中段用成分/场景做可信度，结尾用福利或直播间动作收口。"
  ].join("\n\n");

  return { score, suggestions, content };
}

export async function analyzeMaterial(materialId: number) {
  const material = db.prepare("SELECT * FROM material_metrics WHERE id = ?").get(materialId) as MaterialRow | undefined;
  if (!material) throw new Error("素材不存在。");
  const script = db
    .prepare(
      `SELECT sa.*
       FROM material_script_matches msm
       JOIN script_assets sa ON sa.id = msm.script_asset_id
       WHERE msm.material_metric_id = ?`
    )
    .get(materialId) as ScriptRow | undefined;

  const rule = buildRuleInsight(material, script);
  const settings = getSettings();
  let content = rule.content;
  let provider = "rules";
  let usedAi = 0;

  if (settings.aiApiKey) {
    const prompt = [
      "你是中草集品牌的电商短视频投流优化顾问。请基于数据和脚本输出可执行建议。",
      "输出结构固定为：数据诊断、脚本问题、优化建议、改写方向、合规提醒。",
      `素材：${material.material_name}`,
      `数据：${JSON.stringify(rule.score)}`,
      `脚本：${script?.script_text?.slice(0, 5000) || "未匹配脚本"}`,
      `规则初判：${rule.content}`
    ].join("\n\n");
    try {
      content = await callChatCompletions({
        model: settings.aiTextModel || MINIMAX_MODEL,
        apiKey: settings.aiApiKey,
        baseUrl: settings.aiBaseUrl || MINIMAX_BASE_URL,
        maxTokens: 1800,
        thinking: "adaptive",
        messages: [
          { role: "system", content: "你擅长中文电商短视频投流复盘和脚本优化，回答要具体、可执行、合规。" },
          { role: "user", content: prompt }
        ]
      });
      provider = settings.aiBaseUrl || MINIMAX_BASE_URL;
      usedAi = 1;
    } catch (error) {
      provider = "rules-with-ai-error";
      content = `${rule.content}\n\nAI 生成未完成：${error instanceof Error ? error.message : String(error)}\n\n已先保存本地规则建议，修正 AI 配置后可以重新生成。`;
    }
  }

  const result = db
    .prepare(
      `INSERT INTO optimization_insights
       (material_metric_id, script_asset_id, generated_at, provider, used_ai, score_json, suggestions_json, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(materialId, script?.id ?? null, new Date().toISOString(), provider, usedAi, JSON.stringify(rule.score), JSON.stringify(rule.suggestions), content);

  return db.prepare("SELECT * FROM optimization_insights WHERE id = ?").get(result.lastInsertRowid);
}

function buildScreenshotSummary(provider: string, content: string) {
  return [
    `provider: ${provider}`,
    "页面类型：请根据截图内容判断。",
    "关键指标：",
    content,
    "异常点：如截图中存在 ROI、消耗、成交、点击、转化异常，请结合原文判断。",
    "投流建议：优先复核高消耗低成交素材、ROI 异常账号和截图里的运营动作。"
  ].join("\n");
}

export async function analyzeScreenshot(screenshotId: number) {
  const screenshot = db.prepare("SELECT * FROM screenshots WHERE id = ?").get(screenshotId) as
    | {
        id: number;
        file_name: string;
        path: string;
        extension: string;
      }
    | undefined;
  if (!screenshot) throw new Error("截图不存在。");

  if (!screenshot.path || !fs.existsSync(screenshot.path)) {
    const message = `图片路径不存在或共享盘不可读：${screenshot.path || "空路径"}`;
    db.prepare("UPDATE screenshots SET ai_summary = ?, ai_confidence = ?, ai_analyzed_at = ? WHERE id = ?").run(
      message,
      0,
      new Date().toISOString(),
      screenshotId
    );
    return { ...screenshot, ai_summary: message, ai_confidence: 0 };
  }

  const openClaw = await describeImageWithAgent(screenshot.path);
  if (openClaw.ok && openClaw.content) {
    const content = buildScreenshotSummary("OpenClaw image.describe", openClaw.content);
    db.prepare("UPDATE screenshots SET ai_summary = ?, ai_confidence = ?, ai_analyzed_at = ? WHERE id = ?").run(
      content,
      0.82,
      new Date().toISOString(),
      screenshotId
    );
    return db.prepare("SELECT * FROM screenshots WHERE id = ?").get(screenshotId);
  }

  const settings = getSettings();
  if (!settings.aiApiKey) {
    const fallback = [
      "OpenClaw 截图读取未完成。",
      `截图文件：${screenshot.file_name}`,
      `OpenClaw 原因：${openClaw.error || "返回为空"}`,
      "MiniMax 未调用：尚未配置可用 API Key。",
      "处理建议：确认 OpenClaw profile/provider 权限，或在设置页配置可用 MiniMax-M3 Key 后重试。"
    ].join("\n");
    db.prepare("UPDATE screenshots SET ai_summary = ?, ai_confidence = ?, ai_analyzed_at = ? WHERE id = ?").run(
      fallback,
      0.05,
      new Date().toISOString(),
      screenshotId
    );
    return { ...screenshot, ai_summary: fallback, ai_confidence: 0.05 };
  }

  const mime = screenshot.extension === ".jpg" || screenshot.extension === ".jpeg" ? "image/jpeg" : "image/png";
  const base64 = fs.readFileSync(screenshot.path).toString("base64");
  try {
    const content = await callChatCompletions({
      model: settings.aiVisionModel || settings.aiTextModel || MINIMAX_MODEL,
      apiKey: settings.aiApiKey,
      baseUrl: settings.aiBaseUrl || MINIMAX_BASE_URL,
      maxTokens: 1800,
      thinking: "adaptive",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "请读取这张电商视频运营/投放截图，用中文输出：1. 页面类型；2. 关键指标；3. 异常变化；4. 对投流和脚本优化的建议。无法确定的数字请标注为低置信。"
            },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${base64}` }
            }
          ]
        }
      ]
    });
    const summary = buildScreenshotSummary("MiniMax-M3 image_url fallback", content);
    db.prepare("UPDATE screenshots SET ai_summary = ?, ai_confidence = ?, ai_analyzed_at = ? WHERE id = ?").run(
      summary,
      0.7,
      new Date().toISOString(),
      screenshotId
    );
  } catch (error) {
    const content = [
      "截图读取未完成。",
      `截图文件：${screenshot.file_name}`,
      `OpenClaw 原因：${openClaw.error || "返回为空"}`,
      `MiniMax 原因：${error instanceof Error ? error.message : String(error)}`,
      "处理建议：确认 OpenClaw 能访问本机 .openclaw 状态目录；如使用 MiniMax，请确认 Key 有额度并支持 image_url 多模态输入。"
    ].join("\n");
    db.prepare("UPDATE screenshots SET ai_summary = ?, ai_confidence = ?, ai_analyzed_at = ? WHERE id = ?").run(
      content,
      0.1,
      new Date().toISOString(),
      screenshotId
    );
  }
  return db.prepare("SELECT * FROM screenshots WHERE id = ?").get(screenshotId);
}
