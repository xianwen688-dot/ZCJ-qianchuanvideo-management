import fs from "node:fs/promises";
import JSZip from "jszip";

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function attr(source: string, name: string) {
  return source.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
}

function columnIndex(ref: string) {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(index - 1, 0);
}

function textNodes(xml: string) {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

async function zipText(zip: JSZip, fileName: string) {
  return (await zip.file(fileName)?.async("text")) ?? "";
}

async function sharedStrings(zip: JSZip) {
  const xml = await zipText(zip, "xl/sharedStrings.xml");
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>[\s\S]*?<\/si>/g)].map((match) => textNodes(match[0]));
}

async function worksheetFiles(zip: JSZip) {
  const workbook = await zipText(zip, "xl/workbook.xml");
  const rels = await zipText(zip, "xl/_rels/workbook.xml.rels");
  const relMap = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(match[1], "Id");
    const target = attr(match[1], "Target");
    if (!id || !target) continue;
    const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    relMap.set(id, normalized.replace(/^xl\/xl\//, "xl/"));
  }
  const files: string[] = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const relId = attr(match[1], "r:id");
    const target = relMap.get(relId);
    if (target) files.push(target);
  }
  if (files.length) return files;
  return Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function cellValue(attrs: string, body: string, shared: string[]) {
  const type = attr(attrs, "t");
  if (type === "inlineStr") return textNodes(body);
  const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return shared[Number(rawValue)] ?? "";
  if (rawValue) return decodeXml(rawValue);
  const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? "";
  return formula ? `=${decodeXml(formula)}` : "";
}

function parseWorksheet(xml: string, shared: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = attr(cellMatch[1], "r");
      row[columnIndex(ref)] = cellValue(cellMatch[1], cellMatch[2], shared);
    }
    rows.push(row.map((cell) => cell ?? ""));
  }
  return rows;
}

export async function readXlsxRows(filePath: string) {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const shared = await sharedStrings(zip);
  const files = await worksheetFiles(zip);
  const rows: string[][] = [];
  for (const file of files) {
    const xml = await zipText(zip, file);
    if (xml) rows.push(...parseWorksheet(xml, shared));
  }
  return rows;
}
