// 批量导入现有 CSV 文件
import { runFullSync } from "./sync";

async function main() {
  console.log("开始批量导入...");
  const result = await runFullSync();
  console.log(`\n完成! 共导入 ${result.files.length} 个文件, ${result.totalRows} 行数据`);
  if (result.errors.length) {
    console.log(`错误 (${result.errors.length}):`);
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("导入失败:", err);
  process.exit(1);
});
