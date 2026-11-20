# MiniMax 与发布前就绪记录

日期：2026-11-20

本文件保留 Auralis Voice 从无密钥预检到真实 smoke、再到安全收口的最终事实。它不包含任何真实密钥、令牌、GroupId 或 `voice_id`。

## 当前结论

**LIVE_ACCEPTED**：MiniMax 中国区真实生成、REST 播放与 ChatGPT MCP 猫耳气泡均已完成受控验收；公开仓库和部署线路已经建立。

## 固定范围

- MiniMax 中国区端点：`https://api.minimaxi.com/v1/t2a_v2`
- 必填：`MINIMAX_API_KEY`、`MINIMAX_VOICE_ID`、`MINIMAX_MODEL`
- 可选：`MINIMAX_GROUP_ID`；新版平台通常留空
- loopback 可不配置 `PUBLIC_V1_ACCESS_TOKEN`
- 非 loopback 必须配置至少 32 字符且不含空白的 `PUBLIC_V1_ACCESS_TOKEN`
- Breeze 仅保留 adapter 占位，不进入 V1 运行链路

## 安全门禁

- `POST /api/tts` 在配置令牌时强制 Bearer 鉴权。
- 单实例最多 6 次/60 秒，且同一时刻最多一项 provider 合成。
- 401、限流 429 和并发 429 均不会调用 provider。
- `GET /api/tts` 固定返回 405，不调用 provider。
- 静态文件使用固定白名单；`.env`、源码和目录列表不对外提供。
- 错误响应不返回 API Key、访问令牌、GroupId、`voice_id`、上游完整响应、堆栈或内部路径。

## 视觉锁定

- `public/player/cat-ear-player.js`
- SHA256：`e31b5de45bb44ab92fadbc23240187f135e8abf2db4d84fd5a6e1b478ca59e3f`
- smoke SHA256：`fee6bd3dc06f09dc759abdef230b243a898fa12a11ed2d09ef443662eb61b5f9`

视觉、五态和动态声波已经锁定；接入与文档收口未修改播放器。

## 验证基线

- 完整离线测试：77/77 通过，0 失败
- 鉴权、限流、单并发、并发释放和伪造错误 fail-closed 已覆盖
- Breeze 占位兼容已覆盖
- 视觉锁定已覆盖
- OAuth、PKCE、MCP 工具、WAV 结构校验与用户手势内 Web Audio 播放已覆盖
- 公开 README、部署线路、架构说明与宿主接入契约已收口
- 收口阶段真实 provider 调用次数：0
- 真实 `.env` 未读取、未修改、未打包

## 公开验收结果

- REST 与 ChatGPT MCP 均已生成并实际播放一次受控短句。
- 播放键只在音频结构与时长确认后启用。
- 播放、暂停、继续和播完状态通过；点击播放不会引起气泡外层跳动。
- MCP 气泡不显示密钥、令牌、GroupId、`voice_id` 或上游原始响应。

## 已知重连要求

V1 的 OAuth 授权码、access token 和 refresh token 存于单个服务进程内存。服务
重新部署或重启后，ChatGPT 连接可能需要重新授权并刷新工具。这是当前公开限制，
不应通过自动重试真实 TTS 判断连接是否恢复。

真实 smoke 成功不代表允许公开共享付费 TTS。每位部署者必须使用自己的 MiniMax 配置，并自行控制访问范围和费用。
