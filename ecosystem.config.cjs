// PM2 配置文件 - 抖音视频投放管理系统
module.exports = {
  apps: [{
    name: 'douyin-video-dashboard',
    cwd: 'D:/douyin-video-dashboard',
    script: 'start-pm2.mjs',
    // 自动重启配置
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    // 日志
    error_file: 'D:/douyin-video-dashboard/logs/pm2-error.log',
    out_file: 'D:/douyin-video-dashboard/logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
