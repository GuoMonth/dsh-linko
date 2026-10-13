# Linko

[English](README.md) | 中文

Linko 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的开源、局域网优先 Agent 协作网络。它帮助 Agent 找到合适的协作者，交换带证据的上下文，并在明确的人类授权策略下继续处理任务。

Linko 目前处于设计阶段。本仓库采用规格驱动方式：先定义产品边界、数据契约、网络预算、隐私规则和架构决策，再实现运行时。

## 为什么做 Linko

局域网通信和审批面板只是基础能力。Linko 重点解决会随使用积累价值的问题：

- 每个人和 Agent 都可以维护一份主观、可签名的能力声明与协作证据账本。
- 找人查询会给出个性化推荐，并解释为什么选择这个协作者。
- 上下文按范围和用途共享，不把完整的私人历史广播出去。
- 收到请求后，人可以亲自回答，也可以让 Agent 起草回复，或委托给范围受限的自动回复策略。
- 每次投递都是一个轻量信封，包含给人看的封面、给机器看的语义，以及可选的本地正文或 UI 引用。
- 第一版群聊配置档最多支持 500 名成员，并明确成员策略、Agent 策略和独立的端到端加密里程碑。
- 局域网发现、查询扩展和账本同步使用不同的预算，避免大规模局域网出现广播风暴。

## 项目状态

第一阶段是文档和协议设计，当前不承诺提供可运行插件。

- 产品范围：[English](docs/specs/0001-product-scope.md) · [中文](docs/specs/0001-product-scope.zh.md)
- 架构：[English](docs/architecture.md) · [中文](docs/architecture.zh.md)
- Roadmap：[English](ROADMAP.md) · [中文](ROADMAP.zh.md)
- 决策记录：[English](docs/decisions/README.md) · [中文](docs/decisions/README.zh.md)

## 设计方向

逻辑模型是图，同步模型是追加式签名事件日志，第一阶段物理存储使用 SQLite，并支持 JSONL 导出和回放。用户看到的全局视图是许多签名声明经过该用户的信任关系、隐私规则和任务上下文计算出的版本化投影。本地 Linko 节点拥有持久状态；REST 游标同步负责恢复，WebSocket 负责低延迟。

网络从普通 IP、REST 和 WebSocket 开始，通过 mDNS 或显式配对发现节点。它使用直接请求和先摘要后同步的反熵机制，不使用完整消息泛洪。路由器和交换机特性可以提高上限，但不是运行前提。Rust 和 WebAssembly 只在确定性协议校验、Merkle 同步、路由策略、图布局和上下文脱敏等边界被证明有价值时使用。

## 与 DeepSeek Harness 的关系

Linko 计划作为 DeepSeek Harness 生态中的社区插件和配套协议，同时保持协议本身可以被其他 Agent 和客户端使用。

## 参与贡献

请阅读 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) 和 [AGENTS.md](AGENTS.md)。早期最有价值的贡献包括设计评审、威胁建模、互操作实验和小型协议 fixture。

## Topics

仓库会设置 dsh、dsh-plugin、deepseek-harness、agent-collaboration、local-first、peer-to-peer、websocket、wasm、typescript 和 knowledge-graph 等话题。

## 许可证

[MIT](LICENSE)
