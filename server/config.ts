export const DATA_PATHS = [
  String.raw`E:\视频数据\2026抖音\2026-06_千川视频`,
  String.raw`Z:\摄影部\10.抖音信息流&视频号\0视频投放数据\抖音\2026-06_千川视频`,
] as const;

export const VIDEO_ROOT_PATH = String.raw`Z:\摄影部\10.抖音信息流&视频号\3剪辑成片\抖音信息流`;

export const DEFAULT_CHAT_ID = "PLACEHOLDER"; // 飞书群聊ID，待建立后更新

export const DEFAULT_REPORT_INBOX_PATH = DATA_PATHS[0];
export const DEFAULT_SCRIPT_ROOT_PATH = String.raw`Z:\摄影部\10.抖音信息流&视频号\1祛痘脚本&参考视频`;

export const PORT = Number(process.env.PORT || 8788);
