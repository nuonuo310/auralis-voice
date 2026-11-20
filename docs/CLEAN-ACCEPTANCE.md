# 全新用户离线验收记录

日期：2026-11-20

## 结论

**CLEAN_OFFLINE_ACCEPTANCE=PASS**

完整公开项目被复制到全新文件夹后，仅依据公开 README 进行验收。验收没有读取或打包真实 `.env`，没有联网调用 MiniMax，也没有创建 Git 仓库、Render 服务或其他外部资源。

## 新文件夹检查

- 不含 `.env`
- 不含 `.git`
- 不含 `node_modules`
- 不含真实 API Key、访问令牌、GroupId 或 `voice_id`
- 不含私人项目代码、域名、头像、音频或历史

## 验收结果

- `npm test`：68/68 通过，0 失败
- 使用仅含占位配置的临时环境文件按 README 命令启动：通过
- 默认 loopback 监听：通过
- `GET /health`：200，响应仅含 `status` 与 `provider`
- `GET /player/preview.html`：200
- `GET /player/smoke.html`：200
- `GET /.env`：404
- `GET /src/server.js`：404
- `GET /api/tts`：405，未调用 provider
- 猫耳播放器 SHA256：`e31b5de45bb44ab92fadbc23240187f135e8abf2db4d84fd5a6e1b478ca59e3f`
- smoke 页面 SHA256：`fee6bd3dc06f09dc759abdef230b243a898fa12a11ed2d09ef443662eb61b5f9`
- 真实 provider 调用次数：0

临时环境文件、进程和监听端口在验收后均已清理。

## 尚未执行

- Git 初始化、提交或推送
- 公开发布
- 创建或部署 Render 服务
- 新公网地址的真实 TTS 验收

以上动作仍需项目所有者另行明确授权。
