# 播放器接入契约

Auralis Voice 的服务端负责验证请求、执行安全门禁、调用 MiniMax，并返回经校验的 16 kHz 单声道 PCM WAV。猫耳播放器只管理客户端音频和五态，不保存服务端状态。

## POST /api/tts

受保护部署的请求头：

```text
Authorization: Bearer <token>
Content-Type: application/json
```

loopback 本地开发未配置 `PUBLIC_V1_ACCESS_TOKEN` 时可省略 Authorization。非 loopback 部署必须配置令牌，服务才允许启动。

请求体只允许一个字段：

```json
{
  "text": "需要合成的文字"
}
```

验证规则：

- `text` 必须是非空字符串。
- 去除首尾空白后，按 Unicode 字符计长度为 1 至 1000。
- 任何未知字段均被拒绝，包括 `voice_id`、`model`、GroupId、API Key、访问令牌或接口地址。
- API Key、GroupId、`voice_id`、模型和 MiniMax 端点只来自服务端环境。
- 鉴权失败、命中限流或并发拒绝时不会调用 provider。

成功响应：

- HTTP `200`
- `Content-Type: audio/wav`
- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- 响应体为 WAV 二进制，不是 JSON 包装

失败响应统一为：

```json
{
  "error": {
    "code": "稳定错误码",
    "message": "可公开显示的简短说明"
  }
}
```

服务端不会返回密钥、令牌、GroupId、`voice_id`、完整上游响应、堆栈、环境变量或内部路径。

## GET /health

返回：

```json
{
  "status": "ok",
  "provider": "minimax"
}
```

健康检查不需要 Authorization，也不包含配置内容。

## 稳定错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 请求格式无法解析 |
| 415 | `INVALID_CONTENT_TYPE` | 请求头不是 JSON |
| 400 | `INVALID_JSON` | 请求体为空或不是合法 JSON |
| 400 | `INVALID_BODY` | JSON 顶层不是对象 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体过大 |
| 400 | `UNKNOWN_FIELD` | 含 `text` 以外的字段 |
| 400 | `INVALID_TEXT` | 文本类型或长度不符合要求 |
| 401 | `UNAUTHORIZED` | Bearer 令牌缺失或无效 |
| 429 | `RATE_LIMITED` | 单实例 60 秒内合成请求已达到 6 次 |
| 429 | `TTS_BUSY` | 已有一项 provider 合成正在进行 |
| 404 | `NOT_FOUND` | 路由不存在 |
| 405 | `METHOD_NOT_ALLOWED` | HTTP 方法不允许 |
| 408 | `REQUEST_ABORTED` | 请求被中止 |
| 501 | `ADAPTER_NOT_IMPLEMENTED` | adapter 尚未实现 |
| 502 | `PROVIDER_HTTP_ERROR` | MiniMax 返回 HTTP 错误 |
| 502 | `PROVIDER_BUSINESS_ERROR` | MiniMax 返回业务错误 |
| 502 | `PROVIDER_INVALID_RESPONSE` | MiniMax 响应结构无效 |
| 502 | `PROVIDER_INVALID_AUDIO` | 上游音频编码无效，或未满足 PCM WAV 契约 |
| 502 | `PROVIDER_NETWORK_ERROR` | MiniMax 网络不可达 |
| 504 | `PROVIDER_TIMEOUT` | MiniMax 请求超过 120 秒 |
| 500 | `INTERNAL_ERROR` | 服务端内部错误 |

`GET /api/tts` 在鉴权前返回 HTTP 405 和 `Allow: POST`，不会调用 provider。

## 猫耳播放器稳定接口

固定自定义元素名：

```html
<cat-ear-player id="voicePlayer" color="#D8CEF2"></cat-ear-player>
```

`color` 属性是运行时颜色入口。`player.config.json` 只是示例值，不会被组件自动读取。

公开方法：

- `setAudioBlob(blob)`：装入音频 Blob，并管理旧 Blob URL 的释放。
- `setSource(url)`：装入非空音频 URL。
- `synthesize(text, { endpoint })`：向指定端点请求 TTS；默认端点为 `/api/tts`。
- `play()`、`pause()`、`toggle()`：控制真实 `HTMLAudioElement`。
- `reset()`：回到音频起点和 `idle`。

固定事件：

- `statechange`：`event.detail.state` 为当前播放器状态。
- `playererror`：音频播放失败时 `event.detail.code` 为 `AUDIO_PLAYBACK_ERROR`。

固定五态：`idle`、`loading`、`playing`、`paused`、`ended`。声波只在 `playing` 状态运动；暂停冻结，结束停止。状态由真实音频事件驱动，不用定时器伪造播放进度。

组件卸载、替换 Blob 或请求中止时会清理自身管理的资源。调用者若自行创建其他 Blob URL，仍需自行释放。

## 受保护宿主接入

锁定组件当前的 `synthesize()` 不附加 Authorization：

- loopback、未启用令牌时，可以直接调用 `player.synthesize(text)`。
- 受保护部署不得为此修改锁定播放器。
- 宿主自行带 Bearer 请求 `/api/tts`，取得 WAV Blob 后调用 `player.setAudioBlob(blob)`。
- `accessToken` 应由宿主在当前受控会话中临时取得，不得硬编码进仓库或公开静态文件。

最小宿主示例：

```js
async function loadVoiceIntoPlayer({ player, text, accessToken }) {
  if (!(player instanceof HTMLElement)) throw new TypeError('player is required');
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new TypeError('accessToken is required for protected deployments');
  }

  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.code || 'TTS_REQUEST_FAILED');
  }

  const audioBlob = await response.blob();
  if (!audioBlob.type.startsWith('audio/')) {
    throw new Error('INVALID_AUDIO_RESPONSE');
  }
  player.setAudioBlob(audioBlob);
}
```

示例中的 `accessToken` 是调用参数，不是可直接使用的示例令牌。正式宿主应同源接入；V1 不开放通配 CORS。

## ChatGPT MCP 气泡契约

ChatGPT 私有插件通过 `/mcp` 和 OAuth 2.0 + PKCE 接入，固定工具名为
`speak_with_auralis`，所需 scope 为 `voice:speak`。

- 每次成功工具调用最多执行一次真实 provider 合成，不自动重试或付费 fallback。
- 返回给模型的文本内容不携带音频正文；音频只放在组件专用私有元数据中。
- 气泡先验证 WAV 容器、PCM 格式、采样率、声道、数据长度和真实时长。
- 验证完成前播放键保持禁用；失败时不得呈现“看起来可以播放”的状态。
- 播放在用户点击手势中通过 Web Audio 解码并启动，避免宿主自动播放限制。
- 气泡外层固定为 `276 × 69` CSS 像素并左对齐；字幕位于气泡下方。
- `idle`、播放中、暂停和播完状态切换不得改变外层高度，避免聊天内容上下跳动。

MCP 路线不要求也不允许把 `PUBLIC_V1_ACCESS_TOKEN`、MiniMax API Key 或 OAuth
client secret 放进组件、工具参数或模型可见文本。
