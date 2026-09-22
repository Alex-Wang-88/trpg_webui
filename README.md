# 夜桌 / Night Table

夜桌是一个自托管的多人文字跑团工作台。它把人类玩家、AI KP 和 AI PL 放进同一个聊天房间，使用服务端事件日志记录聊天、骰子和角色状态。

## 当前版本

目前已经包含：

- 桌面优先的暗色跑团房间界面，移动端可用。
- 邀请码创建/加入房间和访客会话。
- PL 座位入座/离座、AI PL 接管和角色卡自动绑定。
- SQLite 事件日志、事件序号、断线后的事件恢复。
- SSE 实时房间事件。
- 服务端骰子表达式解析和 D100 检定。
- CoC-compatible 百分骰角色卡和派生属性。
- D&D SRD-compatible d20 核心、属性修正、熟练加值、AC 和 HP。
- OpenAI 兼容接口的 AI KP 继续场景入口。
- AI PL 座位、剧情草案生成和 SQLite 持久化任务队列。
- OpenAI-compatible 图片生成队列，生成文件保存在自托管数据目录。
- 浏览器麦克风语音转文字按钮，默认识别 `zh-CN`。

## 本地启动

需要 Node.js 22 或更高版本。

```powershell
npm install
npm run server:dev
```

另开一个终端：

```powershell
npm run dev
```

打开 [http://localhost:5188](http://localhost:5188)。前端开发服务使用 `5188`，房间 API 使用 `8788`。

没有启动 API 时，页面会自动使用本地演示模式；启动 API 后，浏览器会创建一个真实 SQLite 房间并连接事件流。

## Docker

复制 `.env.example` 为 `.env`，设置一个随机的 `APP_MASTER_KEY`，然后运行：

```powershell
docker compose up --build
```

浏览器访问 [http://localhost:5188](http://localhost:5188)。SQLite 数据和生成的场景图片会保存在 Docker volume `night_table_data` 中。

## API 快速检查

```powershell
Invoke-RestMethod http://127.0.0.1:8788/api/health
```

创建房间：

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8788/api/rooms `
  -ContentType 'application/json' `
  -Body '{"title":"雾港的第三声钟鸣","system":"coc-percentile","displayName":"房主"}'
```

## 测试

```powershell
npm run test:server
npm test
```

规则计算在 `server/rules/coc.mjs` 和 `server/rules/dnd.mjs` 中执行，浏览器不会直接决定骰子结果。房间 API 的 AI Key 会使用 `APP_MASTER_KEY` 加密保存，不会返回给玩家客户端。文字模型和图片模型可以使用不同的 OpenAI-compatible Base URL；图片模型需要支持 `/images/generations`。

## 规则资料边界

`reference/rules/coc/` 中的 PDF 和 XLSX 是本地研发参考，已加入忽略列表，不会进入公开仓库、Docker 构建上下文或发布包。默认规则包使用原创中文表述；后续 D&D 模块应只分发具有明确再分发许可的 SRD 内容。

## 许可证

代码采用 AGPL-3.0-or-later。规则书、角色卡和其他用户导入资料不随代码分发，使用者需要自行确认其授权范围。
