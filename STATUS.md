# STATUS

更新时间：2026-11-20

## 当前基线

- 版本：`0.1.0`，公开仓库默认分支为 `main`。
- MiniMax：固定中国区 `t2a_v2`；服务端输出并验证 16 kHz 单声道 PCM16 WAV。
- REST：Bearer 鉴权、6 次/60 秒单实例限流、单并发保护和固定错误结构已接入。
- ChatGPT MCP：OAuth 2.0 + PKCE、`voice:speak` scope 和 `speak_with_auralis` 工具已接入。
- 猫耳气泡：音频通过结构校验并取得真实时长后才可播放；播放、暂停、继续、播完与字幕已验收；点击播放不改变外层高度。
- Breeze：仅保留 adapter 占位，不进入 V1 运行链路。

## 验证事实

- 完整离线测试：`77/77` 通过，0 失败。
- MiniMax 中国区真实生成：通过。
- REST 与 ChatGPT MCP 猫耳气泡实际播放：通过。
- 文档收口阶段真实 provider 调用：0。
- 播放器视觉锁：`e31b5de45bb44ab92fadbc23240187f135e8abf2db4d84fd5a6e1b478ca59e3f`。
- smoke 文件锁：`fee6bd3dc06f09dc759abdef230b243a898fa12a11ed2d09ef443662eb61b5f9`。
- 公开文档不含真实密钥、令牌、GroupId、`voice_id`、私人称呼、本机绝对路径或私人域名。

## 已知限制

- OAuth 授权码、access token、refresh token 和限流状态保存在单进程内存中。
- 服务重启或重新部署后，ChatGPT 连接可能需要 `Reconnect` 并 `Refresh tools`。
- V1 适合个人自用或小范围受控接入；不提供公开多用户身份、持久化配额或计费系统。

## 发布安排

- 仓库文档、部署线路、接入契约和版本记录已收口。
- 下一步只安排 2026-11-21 晚间的公开内容发布；发布前不再更改功能或重复真实 TTS。
