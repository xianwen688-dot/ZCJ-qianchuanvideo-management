// Test: generate daily report → push to Feishu
import { generateDailyReport, saveReport } from "./reports";
import { pushReport } from "./feishu-client";

const daily = generateDailyReport("2026-06-26");
console.log(`日报生成: ${daily.content.length} 字符`);

const saved = saveReport("daily", daily.content, daily.date, daily.date);
console.log(`本地保存: ${saved.path}`);

const title = `千川视频投放日报 - ${daily.date}`;
const result = await pushReport(title, daily.content, "daily");
console.log(`推送结果:`, JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
