import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { parse } from "csv-parse/sync";
import { cleanCell, decodeText, extractDateToken, extractMaterialCode } from "./utils";
import { readXlsxRows } from "./xlsxReader";

export interface ScriptSegment {
  index: string;
  videoContent: string;
  narration: string;
  referenceFrame: string;
}

export interface ParsedScript {
  title: string;
  product: string;
  scene: string;
  referenceUrl: string;
  scriptText: string;
  segments: ScriptSegment[];
}

function findReference(text: string) {
  return text.match(/https?:\/\/[^\s，。；;]+/)?.[0] ?? "";
}

function parseRows(rows: unknown[][], fileName: string): ParsedScript {
  let product = "";
  let scene = "";
  let referenceUrl = "";
  let headerIndex = -1;
  let indexCol = -1;
  let contentCol = -1;
  let frameCol = -1;
  let narrationCol = -1;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex].map(cleanCell);
    const joined = cells.join(" ");
    if (!product) {
      const productCell = cells.find((cell) => /^产品[:：]/.test(cell));
      if (productCell) product = productCell.replace(/^产品[:：]/, "").trim();
      if (!product && cells[0]?.includes("产品")) product = cells.slice(1).find(Boolean) ?? "";
    }
    if (!scene && cells[0]?.includes("场景")) scene = cells.slice(1).find(Boolean) ?? "";
    if (!referenceUrl && (cells[0]?.includes("参考") || joined.includes("http"))) {
      referenceUrl = findReference(joined);
    }
    const hasIndex = cells.some((cell) => cell.includes("序号"));
    const hasNarration = cells.some((cell) => cell.includes("文案") || cell.includes("旁白"));
    if (headerIndex < 0 && hasIndex && hasNarration) {
      headerIndex = rowIndex;
      indexCol = cells.findIndex((cell) => cell.includes("序号"));
      contentCol = cells.findIndex((cell) => cell.includes("视频内容"));
      frameCol = cells.findIndex((cell) => cell.includes("参考画面"));
      narrationCol = cells.findIndex((cell) => cell.includes("文案") || cell.includes("旁白"));
    }
  }

  const segments: ScriptSegment[] = [];
  if (headerIndex >= 0) {
    for (const row of rows.slice(headerIndex + 1)) {
      const cells = row.map(cleanCell);
      const index = cleanCell(cells[indexCol]);
      const videoContent = contentCol >= 0 ? cleanCell(cells[contentCol]) : "";
      const referenceFrame = frameCol >= 0 ? cleanCell(cells[frameCol]) : "";
      const narration = narrationCol >= 0 ? cleanCell(cells[narrationCol]) : "";
      if (!index && !videoContent && !narration) continue;
      segments.push({ index, videoContent, referenceFrame, narration });
    }
  }

  const scriptText =
    segments.length > 0
      ? segments
          .map((segment) => [segment.videoContent, segment.narration].filter(Boolean).join("："))
          .filter(Boolean)
          .join("\n")
      : rows
          .flat()
          .map(cleanCell)
          .filter(Boolean)
          .join("\n");

  return {
    title: path.parse(fileName).name,
    product,
    scene,
    referenceUrl,
    scriptText,
    segments
  };
}

export async function parseScriptFile(filePath: string): Promise<ParsedScript> {
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  if (extension === ".xlsx" || extension === ".xls") {
    if (extension === ".xls") throw new Error("Legacy .xls is not supported; please save as .xlsx");
    return parseRows(await readXlsxRows(filePath), fileName);
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value.trim();
    return {
      title: path.parse(fileName).name,
      product: "",
      scene: "",
      referenceUrl: findReference(text),
      scriptText: text,
      segments: []
    };
  }

  const buffer = fs.readFileSync(filePath);
  const text = decodeText(buffer);
  if (extension === ".csv") {
    const rows = parse(text, { relaxColumnCount: true, skipEmptyLines: true }) as string[][];
    return parseRows(rows, fileName);
  }

  return {
    title: path.parse(fileName).name,
    product: "",
    scene: "",
    referenceUrl: findReference(text),
    scriptText: text.trim(),
    segments: []
  };
}

export function inferScriptMeta(filePath: string) {
  const fileName = path.basename(filePath);
  const folderDate = extractDateToken(filePath);
  const materialCode = extractMaterialCode(fileName);
  return {
    fileName,
    extension: path.extname(filePath).toLowerCase(),
    folderDate,
    materialCode
  };
}
