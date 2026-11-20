# MiniMax 与发布前就绪记录

日期：2026-11-20

本文件保留 Auralis Voice 从无密钥预检到真实 smoke、再到安全收口的最终事实。它不包含任何真实密钥、令牌、GroupId 或 `voice_id`。

## 当前结论

**READY_OFFLINE**：MiniMax 中国区真实 smoke 已成功一次，猫耳气泡完成实际播放；公开发布、Git 推送、Render 服务创建和公网验收仍需另行授权。

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

- 完整离线测试：68/68 通过，0 失败
- 鉴权、限流、单并发、并发释放和伪造错误 fail-closed 已覆盖
- Breeze 占位兼容已覆盖
- 视觉锁定已覆盖
- 公开 README 与宿主接入契约已收口
- 收口阶段真实 provider 调用次数：0
- 真实 `.env` 未读取、未修改、未打包

真实 smoke 成功不代表允许公开共享付费 TTS。每位部署者必须使用自己的 MiniMax 配置，并自行控制访问范围和费用。
