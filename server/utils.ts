import crypto from "node:crypto";
import fs from "node:fs";
import iconv from "iconv-lite";

export function sha1File(filePath: string) {
  const hash = crypto.createHash("sha1");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function decodeText(buffer: Buffer) {
  const encodings = ["utf8", "gb18030", "gbk", "utf16le"];
  for (const encoding of encodings) {
    const text = iconv.decode(buffer, encoding);
    if (!text.includes("\uFFFD")) {
      return text.replace(/^\uFEFF/, "");
    }
  }
  return iconv.decode(buffer, "gb18030").replace(/^\uFEFF/, "");
}

export function cleanCell(value: unknown) {
  return String(value ?? "").trim();
}

export function getField(row: Record<string, unknown>, candidates: string[]) {
  const entries = Object.entries(row).map(([key, value]) => [key.trim(), value] as const);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key === candidate || key.includes(candidate));
    if (found) return cleanCell(found[1]);
  }
  return "";
}

export function parseNumber(value: unknown) {
  const text = cleanCell(value)
    .replace(/[¥￥,%\s]/g, "")
    .replace(/,/g, "");
  if (!text || text === "-") return null;
  const multiplier = text.includes("亿") ? 100000000 : text.includes("万") ? 10000 : 1;
  const numeric = Number(text.replace(/[万亿]/g, ""));
  return Number.isFinite(numeric) ? numeric * multiplier : null;
}

export function parsePercent(value: unknown) {
  const text = cleanCell(value);
  if (!text || text === "-") return null;
  const numeric = parseNumber(text);
  if (numeric === null) return null;
  return text.includes("%") ? numeric / 100 : numeric;
}

export function extractMaterialCode(text: string) {
  return text.match(/ZCJ-[A-Z0-9]+-\d{8}-\d{3}/i)?.[0]?.toUpperCase() ?? "";
}

export function extractDateToken(text: string) {
  return text.match(/20\d{6}/)?.[0] ?? "";
}

export function normalizeName(text: string) {
  return text
    .toLowerCase()
    .replace(/\.(mp4|mov|xlsx|xls|docx|doc|csv|txt)$/i, "")
    .replace(/一键修复|修改违禁|投放|已发布|成片|全ai批量|ai剪辑|纯ai拼接|半ai|展/g, "")
    .replace(/[\s_+()[\],.!:;#\-\\/（）【】，。！：；《》“”"']/g, "")
    .trim();
}

export function similarity(a: string, b: string) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  const rows = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0)
  );
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] =
        left[i - 1] === right[j - 1]
          ? rows[i - 1][j - 1] + 1
          : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }
  return (2 * rows[left.length][right.length]) / (left.length + right.length);
}

export function detectPeriodFromPath(filePath: string) {
  const compact = filePath.match(/20\d{4}/)?.[0];
  if (compact) return compact;
  const dashed = filePath.match(/20\d{2}[-_年.]\d{1,2}/)?.[0];
  if (dashed) {
    const numbers = dashed.match(/\d+/g) ?? [];
    if (numbers.length >= 2) return `${numbers[0]}${String(Number(numbers[1])).padStart(2, "0")}`;
  }
  return "";
}

export function detectDateRangeFromName(fileName: string, fallbackPeriod: string) {
  const dateMatches = [...fileName.matchAll(/20\d{2}[-_.]\d{1,2}[-_.]\d{1,2}/g)].map((m) => {
    const [year, month, day] = m[0].split(/[-_.]/).map(Number);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
  if (dateMatches.length >= 2) {
    return { from: dateMatches[0], to: dateMatches[dateMatches.length - 1] };
  }
  if (dateMatches.length === 1) {
    return { from: dateMatches[0], to: dateMatches[0] };
  }
  if (/^20\d{4}$/.test(fallbackPeriod)) {
    const year = Number(fallbackPeriod.slice(0, 4));
    const month = Number(fallbackPeriod.slice(4, 6));
    const lastDay = new Date(year, month, 0).getDate();
    return {
      from: `${year}-${String(month).padStart(2, "0")}-01`,
      to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    };
  }
  return { from: "", to: "" };
}

export function classifyReportType(fileName: string) {
  if (fileName.includes("视频号") && fileName.includes("每条视频数据")) return "wechat_video_detail";
  if (fileName.includes("推商品")) return "product_video";
  if (fileName.includes("推直播")) return "live_video";
  if (fileName.includes("素材分析")) return "material_video";
  if (fileName.includes("概览") || fileName.includes("汇总") || fileName.includes("总表")) return "overview";
  if (fileName.includes("天猫") && fileName.includes("视频内容")) return "tmall_content_video";
  if (fileName.includes("天猫") && fileName.includes("每天内容")) return "tmall_daily_summary";
  if (fileName.includes("推商品")) return "product_video";
  if (fileName.includes("推直播")) return "live_video";
  if (fileName.includes("素材分析")) return "material_video";
  if (fileName.includes("人群")) return "audience";
  if (fileName.includes("概览") || fileName.includes("总")) return "overview";
  return "unknown";
}

export function toIso(value: Date | number | string) {
  return new Date(value).toISOString();
}
