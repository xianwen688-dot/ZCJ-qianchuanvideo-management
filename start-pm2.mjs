// PM2 启动脚本 (ESM) - 加载 .env 并启动服务器
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 读取 .env 文件并设置环境变量
const envPath = path.join(__dirname, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

const tsxPath = path.join(__dirname, 'node_modules', '.bin', 'tsx.cmd');
const serverPath = path.join(__dirname, 'server', 'index.ts');

const child = spawn(tsxPath, [serverPath], {
  cwd: __dirname,
  env: process.env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
