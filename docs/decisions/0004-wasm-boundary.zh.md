# 0004 TypeScript 参考实现与 WASM 边界

状态：设计阶段已接受。

## 决策

TypeScript 7 是第一种实现语言和行为参考。仓库工具链目标为 pnpm 12 与 Node 24 或更新版本。Rust/WebAssembly 只用于适合共享实现的确定性跨运行时代码：事件校验、签名校验、摘要比较、路由策略和脱敏。

WebSocket 生命周期、文件系统访问、DSH 生命周期和平台集成仍由宿主负责。只有 TypeScript fixture 稳定且存在明确边界决策后，才引入 WASM。

## 后果

项目无需一开始就依赖原生工具链，同时保留构建实用 Rust 组件的路径。在 WASM 成为权威实现前，跨运行时 fixture 必须证明两种实现行为一致。
