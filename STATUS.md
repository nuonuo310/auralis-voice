# STATUS

- 工作区：本文件所在项目根目录；发布包不固定本机绝对路径。
- 真实 smoke：MiniMax 中国区固定短句已成功生成，并由猫耳气泡实际播放一次。
- 视觉锁定：v5 播放器仍为 `e31b5de45bb44ab92fadbc23240187f135e8abf2db4d84fd5a6e1b478ca59e3f`，未修改。
- 安全门禁：loopback 可无令牌本地开发；非 loopback 强制至少 32 字符、无空白的 `PUBLIC_V1_ACCESS_TOKEN`；Bearer 鉴权、6 次/60 秒限流和单并发保护已接入。
- OAuth MCP：已实现受保护资源发现、固定 ChatGPT 回调、PKCE S256、授权码单次使用、内存访问/刷新令牌和 `voice:speak` 范围；猫耳组件通过组件专用元数据接收已校验 WAV，并在用户手势内通过 Web Audio 解码播放。
- 回归：完整离线测试 77/77 通过、0 失败；OAuth/MCP、WAV 校验与 Web Audio 门禁、安全负例、Breeze 占位兼容和视觉锁定均已覆盖。
- 文档：公开 README、Render 手工部署说明和正式宿主接入契约已收口；不含公开默认 `voice_id`。
- 干净验收：完整项目已复制到全新文件夹；仅凭公开 README 完成 68/68 测试、环境文件启动命令、健康检查、固定静态路由、敏感路径 404、`GET /api/tts` 405 与视觉哈希复验，真实 provider 调用 0。
- 公开发布：最终门禁通过后，`nuonuo310/auralis-voice` 已由 Private 改为 Public；默认分支为 `main`，发布基线提交为 `86367a13fc59cbc3781f63372f67746e78202229`。
- 许可证：项目所有者已批准 MIT License；版权声明使用 `Auralis Voice contributors`，不含私人姓名。
- 下一步：部署 OAuth MCP 更新并在 ChatGPT 后台手动建立 `Auralis Voice` 私有 MCP 连接，随后只做一次真实语音验收。
