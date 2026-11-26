# 贡献

[English](CONTRIBUTING.md) | 中文

Linko 处于早期的规格驱动阶段。设计评审本身就是贡献，不需要等到代码阶段。

## 提交变更前

- 阅读 AGENTS.md、相关规格及其引用的决策记录。
- 新行为先写或更新规格，再实现。
- 保持中英 Markdown 成对更新。
- 说明隐私、故障、资源和兼容性后果。
- 不复制 Rellopn/dsh-p2p-lan 的实现，详见 ADR 0001。

## TypeScript 与验证

开发基线参照 [DeepSeek Harness v0.2.2-rc.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.5)，采用类型感知的 Oxlint、使用独立 Node 进程的 Vitest，以及共享的严格 TypeScript 配置。Linko 使用 Node 24 或更新版本、pnpm 12 和 TypeScript 7。各包的配置分别按实际运行环境检查 Node ESM 和浏览器 DOM 类型。

- 运行 `pnpm install --frozen-lockfile` 安装依赖。提交 Pull Request 前运行 `pnpm lint`、`pnpm typecheck` 和 `pnpm test`。
- 将 Vitest 用例放在 `packages/<package>/tests/` 下，命名为 `*.spec.ts`。测试公开行为，进程重启、构建产物入口和跨包集成继续由相应的冒烟测试覆盖。
- 文档变更运行 `pnpm docs:check`。涉及运行时边界的改动运行 [CI](.github/workflows/ci.yml) 中对应的冒烟测试。

## 编程规范

- 在边界把不可信输入作为 `unknown` 验证，再传递收窄后的类型。用 `satisfies` 校验字面量，避免 `any`、未经验证的类型断言和非空断言。
- 导出函数声明返回类型，局部变量交给类型推断。用可辨识联合表示互斥状态，从已有定义派生相关类型。
- 数量名称带上单位，布尔值用 `is`、`has` 或 `should` 等词表达含义。沿用已定义的协议字段和数据库命名。
- 等待、返回或显式处理每个 Promise。让调用方能观察到失败，包装错误时保留原始原因，仅对允许缺省的值提供默认值。
- 将相关代码放在调用处附近。在能消除实际重复或表达独立职责时提取函数。注释记录类型无法表达的不变量、副作用或设计原因。

改编自 [clean-typescript](https://github.com/hikariming/anti-slop/blob/main/skills/clean-typescript/SKILL.md)。

## 有用的贡献

- 评审产品范围和未决问题。
- 提出协议 fixture 和对抗性网络场景。
- 测试局域网优先存储与回放设计。
- 协议稳定后，构建独立的 DSH 或非 DSH 客户端实验。

## Pull Request

使用聚焦的标题，说明可观察行为、相关决策记录和验证证据。纯文档变更需要说明它为后续哪个实现决策提供了依据。
