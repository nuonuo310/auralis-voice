# Changelog

本项目使用语义化版本说明公开基线。尚未发布的变更记录在 `Unreleased`。

## Unreleased

- 暂无。

## 0.1.0 - 2026-11-20

首个公开可用基线。

### Included

- MiniMax 中国区 `t2a_v2` 服务端适配与 GroupId 新旧平台兼容。
- 本地 TTS provider adapter 扩展位；Breeze 占位保持 fail-closed，不进入 V1 运行链路。
- 16 kHz 单声道 PCM16 WAV 转换、结构校验和真实时长解析。
- Bearer 保护的 `POST /api/tts`，包含 6 次/60 秒内存限流与单并发保护。
- OAuth 2.0 + PKCE 保护的 ChatGPT MCP，工具名为 `speak_with_auralis`。
- 锁定的猫耳播放器、双耳错峰状态动画、动态声波、字幕和 ChatGPT 内嵌气泡。
- 音频未就绪时禁止播放；通过 WAV 校验后才显示可用按钮与真实时长。
- 默认 loopback 监听、固定静态白名单和敏感路径拒绝。
- MIT License、部署说明、架构线路和稳定接入契约。

### Verified

- 完整离线测试 `77/77` 通过，0 失败。
- MiniMax 中国区真实生成、REST 播放和 ChatGPT MCP 猫耳气泡均完成单次人工验收。
- 播放、暂停、继续与播完状态可用；点击播放不会改变气泡外层高度。

### Known limitations

- OAuth 授权码、access token、refresh token 与限流状态保存在单进程内存中。
- 服务重启或重新部署后，ChatGPT 连接可能需要重新授权并刷新工具。
- V1 面向个人自用或小范围受控接入，不是公开多用户语音平台。
