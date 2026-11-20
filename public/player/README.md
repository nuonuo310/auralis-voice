# Auralis Voice 猫耳播放器

这份播放器是 Auralis Voice 的锁定视觉组件。默认颜色为 `#D8CEF2`，不含头像、音频、密钥、令牌或私人配置。

## 文件

- `cat-ear-player.js`：播放器组件、五态和动态声波。
- `preview.html`：不调用真实 TTS 的离线五态预览。
- `smoke.html`：部署者受控的单次真实验收页，不是产品入口。
- `visual-master.svg`：已确认的静态视觉母版。

## 使用

```html
<script type="module" src="./cat-ear-player.js"></script>
<cat-ear-player id="voicePlayer" color="#D8CEF2"></cat-ear-player>
```

运行时颜色以 `color` 属性为准。根目录的 `player.config.json` 只是颜色示例，不会被组件自动读取。

仅在 loopback 且服务端未启用访问令牌时，可以直接请求：

```js
const player = document.querySelector('#voicePlayer');
await player.synthesize('需要生成的公开示例文字');
```

受保护部署中，`synthesize()` 不会附加 Authorization。宿主必须自行携带 Bearer 令牌请求 `/api/tts`，再把返回的音频 Blob 交给播放器：

```js
player.setAudioBlob(audioBlob);
```

完整宿主示例和错误码见 `../../docs/PLAYER-CONTRACT.md`。不得把真实令牌写入本目录中的静态文件。

## 稳定接口

- 方法：`setAudioBlob()`、`setSource()`、`synthesize()`、`play()`、`pause()`、`toggle()`、`reset()`。
- 事件：`statechange`（`detail.state`）和 `playererror`。
- 五态：`idle`、`loading`、`playing`、`paused`、`ended`。

声波只在 `playing` 状态运动。暂停会冻结，播完会收平。五态和声波由真实 `HTMLAudioElement` 事件驱动；组件会释放自己创建的 Blob URL。

## 视觉边界

猫耳轮廓、耳芯关系、气泡圆角、内部间距、默认配色和五态动画含义已经锁定。接入时不得重绘、替换或重新解释这些视觉；不添加头像。

真实宿主接入前，应在目标浏览器验证播放、暂停、续播、播完、Blob URL 释放和移动端宽度。

ChatGPT MCP 使用独立包装层承载同一视觉语言：音频结构和真实时长通过校验前，
播放键必须保持禁用；播放在用户点击手势中启动；外层高度在播放前后保持固定，
不得因状态文字或控件切换引起聊天内容上下跳动。包装层的详细契约见
`../../docs/PLAYER-CONTRACT.md`，锁定组件本身不因 MCP 接入而修改。
