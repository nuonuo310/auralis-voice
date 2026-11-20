# 部署与 ChatGPT 连接

本文用于部署自己的 Auralis Voice 实例。不要把真实密钥、令牌、音色 ID 或 OAuth
secret 提交到 Git。

## 1. 本地预检

要求 Node.js 20 或更高版本。

```text
npm install
npm test
```

发布基线应为 `77/77` 通过、0 失败。

复制 `.env.example` 为 `.env`，填写部署者自己的 MiniMax 配置。本地 loopback
开发可以暂时留空 `PUBLIC_V1_ACCESS_TOKEN`：

```text
node --env-file=.env src/server.js
```

依次检查：

- `GET http://127.0.0.1:3000/health`
- `GET http://127.0.0.1:3000/player/preview.html`
- 不需要真实 TTS 时，不打开或点击 `smoke.html`

## 2. 生产环境门禁

云部署至少配置：

```dotenv
MINIMAX_API_KEY=
MINIMAX_GROUP_ID=
MINIMAX_VOICE_ID=
MINIMAX_MODEL=
PUBLIC_V1_ACCESS_TOKEN=
HOST=0.0.0.0
```

- `PUBLIC_V1_ACCESS_TOKEN` 至少 32 字符且不得含空白。
- `MINIMAX_GROUP_ID` 在新版平台通常留空。
- `PORT` 使用平台自动注入值，不要固定覆盖。
- 非 loopback 缺少合格访问令牌时，服务会 fail closed 并拒绝启动。

## 3. Render Web Service

创建一个 Git-backed Web Service：

| 设置 | 值 |
| --- | --- |
| Runtime | Node |
| Node version | 20 或更高 |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` |
| Branch | `main` |

把所有真实配置填入 Render 的环境变量界面，不要写入仓库。部署完成后先确认
`/health` 返回 200，再进行任何真实语音验收。

## 4. 启用 ChatGPT 私有 MCP

额外配置：

```dotenv
AURALIS_PUBLIC_ORIGIN=https://your-service.example
AURALIS_OAUTH_CLIENT_ID=
AURALIS_OAUTH_CLIENT_SECRET=
AURALIS_OAUTH_REDIRECT_URI=
```

要求：

- `AURALIS_PUBLIC_ORIGIN` 是精确 HTTPS origin，不带路径、查询串或结尾斜杠。
- client ID 为 8 至 128 个无空白字符。
- client secret 至少 32 个字符且不得含空白。
- redirect URI 使用 ChatGPT 本次连接显示的精确 Callback URL。

在 ChatGPT 的插件设置中添加自定义 MCP：

| 设置 | 值 |
| --- | --- |
| Name | `Auralis Voice` |
| Server URL | `https://你的部署域名/mcp` |
| Authentication | OAuth |
| Registration | User-Defined OAuth Client |
| Token endpoint auth | `client_secret_post` |
| Scope | `voice:speak` |

若 ChatGPT 显示的 Callback URL 与当前环境变量不同，先更新
`AURALIS_OAUTH_REDIRECT_URI` 并重新部署，再完成连接。

## 5. 部署后验收顺序

1. `/health` 返回 `200`，且只包含 `status` 与 `provider`。
2. `/.env`、`/src/server.js` 和目录路径返回 `404`。
3. `GET /api/tts` 返回 `405`，provider 调用为 0。
4. 无令牌或错令牌的 `POST /api/tts` 返回 `401`，provider 调用为 0。
5. `preview.html` 的五态和移动端宽度正确。
6. 获得部署者明确授权后，只执行一次短句真实 TTS。
7. 音频未就绪时播放键禁用；就绪后显示真实时长并可播放。
8. 点击播放不引发布局跳动，暂停、继续和播完状态正确。

## 6. 重启与重新连接

V1 的 OAuth 授权码、access token 和 refresh token 都存于服务进程内存。Render
重新部署、重启或冷启动替换进程后，旧 ChatGPT 连接可能无法刷新工具。

恢复顺序：

1. 确认新部署状态为 live，且 `/health` 正常。
2. 在 ChatGPT 插件设置的 Connected accounts 中选择 `Reconnect`。
3. 完成 OAuth 后点击 `Refresh tools`。
4. 先确认刷新无错误，再决定是否执行一次真实语音验收。

这是 V1 已知限制。不要通过自动重试 TTS 来判断连接是否恢复。
