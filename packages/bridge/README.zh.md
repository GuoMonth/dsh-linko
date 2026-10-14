# Linko DSH companion bridge

[English](README.md) | 中文

`@dsh-linko/bridge` 是 DSH 风格 Host 与一个本地 Linko 节点之间的小型、可替换 TypeScript 适配器。它定义 Host 侧工具契约，不导入、复制或依赖 DeepSeek Harness 源码。Bridge 将契约翻译为 Linko 已有的 loopback REST API；不会增加节点路由，也不会修改 node 和 web package。

## 契约

Bridge 暴露六个操作：

| 操作 | 效果 | Linko 请求 |
| --- | --- | --- |
| `ask` | 构造 Agent 请求并在本地提交；传入 `targetPeerId` 时交给已配置 Peer 的出站队列。 | `POST /v1/envelopes` 或 `POST /v1/send` |
| `inbox` | 列出本地收件箱投影。 | `GET /v1/inbox` |
| `inspect` | 读取一条事件及其投递/阅读/动作投影。 | `GET /v1/inbox/:eventId` |
| `draft` | 读取父事件并返回未提交的回复信封。 | `GET /v1/inbox/:eventId` |
| `approve` | 记录请求的 `approve` 动作；节点检查动作列表和过期时间。 | `POST /v1/receipts` |
| `reply` | 起草并提交一条 `parents` 包含目标事件 ID 的回复。 | `GET /v1/inbox/:eventId`，再调用 `POST /v1/envelopes` 或 `POST /v1/send` |

`draft` 对 Linko 是纯操作：返回的对象没有 `id`。提交它的是 `reply`，节点随后推导不可变事件 ID。Bridge 按原样报告节点事实，不会把 `confirmed` 变成批准，也不会推断消息已经阅读。

## Host 与 Client 边界

**Host** 负责 Agent 运行时、工具注册、凭据、人类审批策略、上下文选择，以及任何外部副作用的执行。调用 `bridge.register(host)` 时，Host 只需实现 `registerTool`；六个描述符和处理器就是全部 Host 集成面。

**Client** 负责连接一个 loopback `http:` 或 `https:` Linko API Origin。`LinkoLocalClient` 校验 Origin、限制 JSON 响应大小、检查响应结构，并把节点错误转换成 `LinkoBridgeError`。Peer 发现、HTTPS Peer 认证、重试、持久存储和投影仍由节点负责。

批准只记录 Linko 回执。它不会执行命令、授予能力、发送 Host 消息或调用 LLM。Host 可以根据自身策略在批准后调用 `reply`。

## 本 package 不支持

- DeepSeek Harness 内部实现、插件加载、调度器 API 或 Host 专用 SDK 类型。
- LLM 提示词、协作者排序、上下文检索或自动策略决策。
- 直接 Peer socket、局域网发现、WebSocket 提示或远程/非 loopback Linko API。
- 密码学签名、消息层 E2EE、能力签发或执行已批准的工作。
- 保证 Peer 已收到排队的 `ask` 或 `reply`；投递仍以节点可观察的 outbox 状态为准。

这些裁剪让 Bridge 保持可替换。其他 Host 或 Client 可以基于公开的 Linko 信封和回执契约实现同样的六个操作。

## API 与 CLI

```ts
import { createDshCompanionBridge, LinkoLocalClient } from '@dsh-linko/bridge';

const bridge = createDshCompanionBridge({
  client: new LinkoLocalClient('http://127.0.0.1:8787'),
});

const request = await bridge.ask({
  title: 'Review a fixture',
  body: 'Please inspect this fixture and approve a scoped reply.',
  agentId: 'agent:example',
});
const events = await bridge.inbox();
await bridge.approve({ eventId: request.eventId, actionId: 'approve' });
const reply = await bridge.reply({ eventId: request.eventId, body: 'Approved.' });
```

无依赖 CLI 使用同一契约，JSON 可以作为参数传入，也可以从 stdin 读取。在此 checkout 中运行时先构建 package：

```sh
pnpm bridge:build
LINKO_LOCAL_URL=http://127.0.0.1:8787 \
  node packages/bridge/dist/cli.js inbox --json '{}'
node packages/bridge/dist/cli.js approve --json '{"eventId":"sha256:...","actionId":"approve"}'
```

## 契约 fixture

在仓库根目录构建并运行：

```sh
pnpm bridge:contract:smoke
```

它启动一个内存 Linko 节点，依次验证 `ask → inbox → inspect → draft → approve → reply`，再用相同的本地 API 检查 CLI 适配器。fixture 只导入 Linko 公开的 node server 和 bridge package，不假设任何 DSH 实现。
