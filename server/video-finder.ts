import fs from "node:fs";
import path from "node:path";
import { VIDEO_ROOT_PATH } from "./config";

/** 递归搜索共享盘，根据素材名匹配视频文件 */
export function findVideoFile(materialName: string): string | null {
  if (!fs.existsSync(VIDEO_ROOT_PATH)) return null;

  const basename = path.basename(materialName);

  // Walk all subdirs, find file matching the name (fuzzy/exact)
  const results = searchDirectory(VIDEO_ROOT_PATH, basename, 0);

  if (results.length > 0) {
    // Prefer exact name match
    const exact = results.find((r) => path.basename(r) === basename);
    return exact || results[0];
  }

  // Fallback: try without extension, try partial match
  const noExt = basename.replace(/\.\w+$/, "");
  const results2 = searchDirectory(VIDEO_ROOT_PATH, noExt, 0);
  if (results2.length > 0) {
    return results2[0];
  }

  return null;
}

function searchDirectory(root: string, keyword: string, _depth: number): string[] {
  const results: string[] = [];
  const keywordLower = keyword.toLowerCase();
  if (!fs.existsSync(root)) return results;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Limit depth to avoid searching too deep
      if (_depth < 5) {
        results.push(...searchDirectory(full, keyword, _depth + 1));
      }
    } else if (entry.isFile() && /\.(mp4|mov|webm|avi)$/i.test(entry.name)) {
      if (entry.name.toLowerCase().includes(keywordLower)) {
        results.push(full);
      }
    }
  }
  return results;
}

/** 列出某素材的所有可用视频文件 */
export function listMatchingVideos(materialName: string): string[] {
  if (!fs.existsSync(VIDEO_ROOT_PATH)) return [];
  const basename = path.basename(materialName);
  const noExt = basename.replace(/\.\w+$/, "");
  return searchDirectory(VIDEO_ROOT_PATH, noExt, 0);
}
