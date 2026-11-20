# Auralis Voice

Auralis Voice 是一套可公开分发、由部署者自行运行的轻量 MiniMax 中国区 TTS 语音系统，包含本地服务、安全接口、GPT 电脑端接入所需契约和猫耳播放界面。它不是项目作者向陌生人提供的共享付费语音实例：每位部署者都使用自己的 MiniMax API Key、`voice_id`、模型和访问令牌。

项目不提供公开默认 `voice_id`，也不包含任何真实密钥、私人音色或私人项目资产。

## V1 能做什么

- 服务端调用 MiniMax 中国区 `https://api.minimaxi.com/v1/t2a_v2`，返回 MP3。
- 猫耳播放器包含 `idle`、`loading`、`playing`、`paused`、`ended` 五态和由真实音频事件驱动的动态声波。
- 一次 MiniMax 中国区真实 smoke 已成功完成生成和播放。
- `/api/tts` 已有 Bearer 鉴权、单实例内存限流（6 次/60 秒）和单并发保护。
- Breeze 仅保留 adapter 占位，不进入 V1 运行链路。

V1 不包含账号、收藏、声音馆、长期记忆、Dashboard、多用户后台或完整主题系统。

## 环境要求

- Node.js 20。
- MiniMax 中国区账号。
- 部署者自己的 API Key、`voice_id` 和模型名称。

项目使用官方 Model Context Protocol SDK、MCP Apps 扩展与 Zod 来提供可选的 ChatGPT 私有 MCP 连接。

## 全新文件夹本地部署

1. 将项目文件放入一个全新文件夹并进入项目根目录。
2. 安装项目依赖：

   ```text
   npm install
   ```

   这一步会安装 MCP 服务与猫耳组件宿主所需的固定依赖。

3. 运行离线测试：

   ```text
   npm test
   ```

   当前发布基线应为 73/73 通过、0 失败。

4. 将 `.env.example` 复制为 `.env`，填写部署者自己的值：

   ```dotenv
   MINIMAX_API_KEY=
   MINIMAX_GROUP_ID=
   MINIMAX_VOICE_ID=
   MINIMAX_MODEL=
   PUBLIC_V1_ACCESS_TOKEN=
   AURALIS_PUBLIC_ORIGIN=
   AURALIS_OAUTH_CLIENT_ID=
   AURALIS_OAUTH_CLIENT_SECRET=
   ```

   `MINIMAX_GROUP_ID` 在新版平台通常留空；只有旧账号明确获得 GroupId 时才填写。`PUBLIC_V1_ACCESS_TOKEN` 在仅监听 loopback 的本地开发中可以留空。

5. 使用 Node 自带的环境文件加载启动：

   ```text
   node --env-file=.env src/server.js
   ```

   默认只监听 `127.0.0.1:3000`。

6. 检查健康状态：

   ```text
   http://127.0.0.1:3000/health
   ```

7. 打开 `http://127.0.0.1:3000/player/preview.html` 验收五态视觉。`/player/smoke.html` 只供部署者进行受控的单次真实 TTS 验收，不是正式产品入口。

不要提交、上传或公开 `.env`。

## 服务端配置

| 环境变量 | 是否必填 | 用途 |
| --- | --- | --- |
| `MINIMAX_API_KEY` | 是 | 部署者自己的 MiniMax 中国区 API Key |
| `MINIMAX_GROUP_ID` | 否 | 新版平台通常留空；旧账号按平台提供值填写 |
| `MINIMAX_VOICE_ID` | 是 | 部署者自己的音色 ID |
| `MINIMAX_MODEL` | 是 | MiniMax 模型名称 |
| `PUBLIC_V1_ACCESS_TOKEN` | 见下文 | 非 loopback 部署强制要求的访问令牌 |
| `AURALIS_PUBLIC_ORIGIN` | MCP 时必填 | 部署服务的精确 HTTPS origin，例如 `https://example.onrender.com` |
| `AURALIS_OAUTH_CLIENT_ID` | MCP 时必填 | ChatGPT 私有连接使用的公开客户端标识 |
| `AURALIS_OAUTH_CLIENT_SECRET` | MCP 时必填 | 至少 32 字符的 OAuth 客户端密钥；不得写入仓库或前端 |
| `HOST` | 否 | 默认 `127.0.0.1`；部署平台通常设为 `0.0.0.0` |
| `PORT` | 否 | 默认 `3000`；部署平台应使用其注入值 |

服务端固定使用 MiniMax 中国区端点，不接受客户端覆盖 API Key、GroupId、`voice_id`、模型或端点。

## 访问令牌与使用边界

- loopback 本地开发可以不配置 `PUBLIC_V1_ACCESS_TOKEN`。
- 当 `HOST` 不是 loopback 时，服务拒绝在缺少有效令牌的情况下启动。令牌必须至少 32 个字符且不能包含空白。
- 受保护的 `POST /api/tts` 请求必须包含 `Authorization: Bearer <token>`。
- `/health` 和固定播放器静态文件不要求令牌。
- 真实令牌不得写入仓库、公开静态页、示例、客户端源码或日志。

共享浏览器令牌不是账号系统，无法安全服务无限陌生用户。本 V1 适用于部署者自用或小范围受控接入；若需要面向陌生用户开放，必须另行设计正式身份、配额和计费保护，不属于 V1。

## API 与播放器

- `GET /health`：返回服务状态和 provider 名称。
- `POST /api/tts`：请求体只允许 `{ "text": "..." }`，成功时直接返回 `audio/mpeg`。
- `GET /player/preview.html`：离线五态视觉预览。
- `GET /player/smoke.html`：部署者受控的一次性真实验收页。
- `POST /mcp`：可选的 OAuth 保护 MCP 入口，仅向已连接的 ChatGPT 私有插件提供语音工具和猫耳组件。

完整请求、错误码、播放器方法、事件和受保护宿主接入示例见 [`docs/PLAYER-CONTRACT.md`](docs/PLAYER-CONTRACT.md)。

`player.config.json` 只是颜色示例，不会被组件自动读取。运行时颜色以元素属性为准：

```html
<cat-ear-player color="#D8CEF2"></cat-ear-player>
```

API Key、GroupId、`voice_id` 和模型始终只来自服务端环境。

## Render 手工部署

本节只是公开部署说明，不会自动创建任何外部资源。

在全新的 Render Web Service 中使用：

- Runtime：Node
- Node：20
- Start Command：`npm start`
- Health Check Path：`/health`
- `HOST=0.0.0.0`
- `PORT`：使用 Render 自动注入的值，不要固定填写
- 配置 `MINIMAX_API_KEY`、`MINIMAX_VOICE_ID`、`MINIMAX_MODEL` 和至少 32 字符、无空白的 `PUBLIC_V1_ACCESS_TOKEN`
- `MINIMAX_GROUP_ID`：新版平台留空；旧账号按平台提供值填写
- 若启用 ChatGPT 私有 MCP，再配置 `AURALIS_PUBLIC_ORIGIN`、`AURALIS_OAUTH_CLIENT_ID` 和至少 32 字符的 `AURALIS_OAUTH_CLIENT_SECRET`

部署后先检查 `/health`，再按接入契约由受控宿主携带 Bearer 令牌请求 `/api/tts`。不要把令牌写进公开的 `preview.html`、`smoke.html` 或其他静态文件。

## ChatGPT 私有 MCP 连接

部署完成后，在 ChatGPT 的 Plugins 页面选择 **Add → Add custom MCP server**：

- Name：`Auralis Voice`
- Server URL：`https://你的部署域名/mcp`
- Authentication：`OAuth`
- Registration method：`User-Defined OAuth Client`
- Callback URL：服务端只接受 ChatGPT 显示的 `https://chatgpt.com/connector_platform_oauth_redirect`
- OAuth client ID / secret：分别填写服务端的 `AURALIS_OAUTH_CLIENT_ID` / `AURALIS_OAUTH_CLIENT_SECRET`
- Token endpoint auth method：`client_secret_post`
- Scope：`voice:speak`

OAuth 授权码使用 PKCE S256、五分钟单次有效；访问令牌和刷新令牌只保存在服务进程内存中。部署重启后需要重新连接，这是 V1 的有意安全边界。插件工具只有在用户明确要求听语音时才应调用；播放器音频通过组件专用元数据交付，不进入普通模型文本。

## 范围与发布门禁

- 猫耳播放器的视觉、圆角、内部间距、默认配色和五态动画含义已经锁定。
- V1 只实现 MiniMax；Breeze 不在本版本实现。
- 本版本不会自动公开、部署或创建 Render 资源；这些外部操作由部署者在确认配置和费用边界后自行执行。

## 许可证

本项目使用 [MIT License](LICENSE)。任何人可以在保留版权与许可声明的前提下使用、修改和分发代码；部署者仍须自行遵守 MiniMax 等第三方服务的条款并保护自己的密钥、音色与访问令牌。
