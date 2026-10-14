# Linko

[English](README.md) | 中文

Linko 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的开源、本地优先协作网。它帮助 Agent 找到合适的协作者，在明确的人类控制策略下交换有范围的上下文并继续任务。

Linko 已进入可运行的早期 MVP。本仓库仍采用规格驱动：运行时代码与产品边界、状态转移、投递恢复、隐私规则和架构决策并列维护。

## 为什么做 Linko

局域网消息和审批面板是有用的基础设施。Linko 增加的是随个人证据和上下文积累而变得更有用的协作层：

- 每个人和 Agent 都可以维护主观的能力声明；后续版本可以附加签名，但不生成全局信誉分。
- 任务查询可以给出带证据与解释的本地推荐。
- 上下文按范围和用途共享，不把完整私人历史广播出去。
- 人可以直接回复、让自己的 Agent 起草回复，或委托有边界的响应策略。
- 每次投递都是小型信封，包含人类可读封面、机器可读语义，以及可选的本地正文或安全界面。
- 第一版群配置档限制为 500 个成员主体；群投递与消息层 E2EE 分成不同里程碑。

## 项目状态

MVP 现在包含 SQLite 节点和以人为先的信封收件箱，并支持明确配对的双节点 HTTPS 配置档：持久出站队列、证书指纹固定、Bearer 认证、可重试 command ID 和 REST 恢复都已接通。WebSocket 提示、消息签名和 E2EE 仍是后续里程碑；这不代表已经支持 2 万节点容量。

- 产品范围：[English](docs/specs/0001-product-scope.md) · [中文](docs/specs/0001-product-scope.zh.md)
- 架构：[English](docs/architecture.md) · [中文](docs/architecture.zh.md)
- 数据与状态：[English](docs/specs/0005-state-and-storage.md) · [中文](docs/specs/0005-state-and-storage.zh.md)
- 复盘记录：[English](docs/review.md) · [中文](docs/review.zh.md)
- Roadmap：[English](ROADMAP.md) · [中文](ROADMAP.zh.md)
- 决策记录：[English](docs/decisions/README.md) · [中文](docs/decisions/README.zh.md)
- 本地节点 MVP：[English](packages/node/README.md) · [中文](packages/node/README.zh.md)
- 信封收件箱 UI：[English](packages/web/DESIGN.md) · [中文](packages/web/DESIGN.zh.md)

## 设计方向

第一版物理存储是一个 TypeScript 节点后的一个 SQLite 数据库。不可变事件内容是持久事实；投递尝试、已读、审批和通知是本地运行状态。REST 游标拉取用于恢复，WebSocket 只是可选唤醒提示。未来可以把声明物化为图视图，但第一版不需要图数据库。

网络从普通 IP、TCP 上的 HTTPS 和可选 WebSocket 开始，使用显式配对与可选 mDNS 提示。不要求任何路由器或交换机特性。DHT、Merkle 同步、全连接 socket、区块链共识和 Rust/WASM 都是停车场实验，必须先有测量理由和回退测试。

## DeepSeek Harness 适配

Linko 计划作为 DeepSeek Harness 生态的社区插件和伴随协议。它吸收 Harness 的可组合插件理念，同时保持协议可以被其他 Agent 和客户端独立使用。

## 贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和仓库规则 [AGENTS.md](AGENTS.md)。当前最有价值的贡献是设计审查、威胁建模、互操作实验和小型协议 fixture。

## Topics

仓库主题包括 dsh、dsh-plugin、deepseek-harness、agent-collaboration、local-first、peer-to-peer、websocket 和 typescript。

## 许可证

[MIT](LICENSE)
