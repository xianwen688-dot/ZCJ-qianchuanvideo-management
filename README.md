# 抖音视频投放管理系统

> 中草集千川视频投放数据分析看板 · Glassmorphism UI · 局域网部署

## 功能

- 📊 **视频投放数据看板** — 8 个核心 KPI + 祛痘类专项 + Chart.js 趋势图/饼图/柱状图
- 🎬 **视频素材管理** — 245 个素材列表/分页/搜索/详情/趋势 · 视频预览（同名匹配共享盘）
- 📦 **商品分析** — 22 个商品消耗/ROI/订单对比
- 📋 **投放计划** — 11 个千川计划消耗明细
- 📈 **数据报告** — 日报/周报/月报自动生成 · 推送飞书群
- ⚠️ **预警系统** — 零成交/ROI骤降/消耗异常/爆款发现 · 每小时检查
- 🔄 **自动同步** — chokidar 双目录文件监控 · 30分钟全量扫描兜底

## 技术栈

| 层 | 技术 |
|:---|:---|
| 后端 | Express 5 + TypeScript |
| 前端 | React 19 + Vite 7 |
| 数据库 | SQLite (WAL 模式) |
| 图表 | Chart.js 4 + react-chartjs-2 |
| UI | Glassmorphism (12px blur + 15%透明白) |
| 定时 | node-cron |
| 文件监控 | chokidar (polling 模式) |
| 飞书 | lark-cli + cc-connect |

## 快速启动

```bash
# 安装依赖
npm install

# 导入数据
python import-data.py

# 启动服务 (生产模式)
npm run start

# 开发模式
npm run dev    # Vite dev server (端口 5174)
npm run server # Express server (端口 8788)
```

## 访问地址

```
http://localhost:8788              (本机)
http://DESKTOP-8NF938N:8788        (局域网)
```

## 端口规划

| 项目 | 生产端口 | Dev端口 |
|:---|:---|:---|
| 抖音视频投放管理 (本项目) | 8788 | 5174 |
| 旧版视频投放管理 | 8787 | 5173 |

两个项目完全隔离，互不影响。

## 数据源

```
E:\视频数据\2026抖音\2026-06_千川视频\        ← 本机
  ├── 视频/   (全域推广数据-视频-*.csv, GBK, 27列)
  ├── 商品/   (全域推广数据_商品_*.csv, GBK, 22列)
  └── 计划/   (全域推广数据_计划_*.csv, GBK, 20列)

Z:\摄影部\...\0视频投放数据\抖音\2026-06_千川视频\  ← 共享盘（镜像）
```

## 数据 KPI 验证 (2026-06-11 ~ 2026-06-24)

| 指标 | 数值 |
|:---|:---|
| 整体消耗 | ¥59,254.83 |
| 整体成交金额 | ¥98,750.41 |
| 整体支付ROI | 1.67 |
| 净成交ROI | 1.51 |
| 保守预估ROI(减15%退货) | 1.28 |
| 祛痘类消耗占比 | 69.4% |
| 视频素材数 | 245 |

## 目录结构

```
douyin-video-dashboard/
├── server/           # Express 后端
│   ├── index.ts      # 入口 + 路由
│   ├── db.ts         # SQLite 数据库
│   ├── sync.ts       # 数据查询引擎
│   ├── parser.ts     # CSV 解析器
│   ├── importer.ts   # 去重入库
│   ├── watcher.ts    # 文件监控
│   ├── reports.ts    # 报告引擎
│   ├── feishu-client.ts  # 飞书集成
│   ├── alerts.ts     # 预警引擎
│   └── video-finder.ts   # 视频文件匹配
├── src/              # React 前端
│   ├── App.tsx       # 主应用
│   ├── styles.css    # Glassmorphism 样式
│   ├── types.ts      # 类型定义
│   └── components/   # 图表/面板组件
├── data/             # SQLite 数据库
├── reports/          # 报告输出
├── import-data.py    # Python 数据导入脚本
└── start.bat         # Windows 启动脚本
```

## 定时任务

| 任务 | 时间 | 说明 |
|:---|:---|:---|
| 日报推送 | 每日 9:30 | 自动生成并推送飞书 |
| 周报推送 | 每周一 9:30 | 周维度数据分析 |
| 月报推送 | 每月1日 9:30 | 月度全面复盘 |
| 预警检查 | 每小时 | 4级预警自动触发 |

## 管理员

- 账号: `admin`
- 角色: 管理员 | 只读用户
- Web 管理面板可配置数据路径/飞书/预警阈值
