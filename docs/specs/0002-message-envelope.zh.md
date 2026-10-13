# 0002 信封消息与会话语义

[English](0002-message-envelope.md) | 中文

状态：草案。

## 范围

本规格定义 Linko 消息的稳定形态。消息是可以独立投递、存储、打开、引用和执行的信封，不依赖某一个 UI。信封同时适用于人的简短消息、Agent 请求、长篇证据、附件和渲染页面。

## 信封模型

一个信封包含四个相互关联的部分：

- **封面**：始终可用，用于收件箱和通知的轻量投影。
- **正文引用**：可选的内嵌正文，或指向本地对象的内容寻址引用。
- **界面引用**：可选的、受约束且可重放的人类 UI surface 引用。
- **封印与策略**：身份、作者、哈希、过期、可见性、权限和投递预算。

封面必须足以让接收方决定打开、延后、静音或审批消息。短消息可以直接内嵌正文；较大的正文应在封面落盘后，再从本地缓存或可达节点获取。

规范消息不可变。投递、展示、已读、审批和执行状态通过独立的签名事件或本地投影表示。客户端不能修改原始消息来表达后续状态。

## 作者与参与者类型

每个信封都要标识创建消息的参与者。协议区分：

- `human`：人编写并发送；
- `agent-delegated`：Agent 在人的授权下编写或发送；
- `agent-autonomous`：Agent 根据自身本地策略自主编写并发送；
- `system`：Linko 节点为传输或同步生成的事件。

存在委托时，信封分别保存作者、编写者、发送者和授权者。Agent 不能把自主消息表现成人类作者消息。

## Agent 控制

Agent 信封必须包含意图和策略分类。第一版意图包括 `inform`、`suggest`、`request`、`delegate` 和 `command`。接收策略可以自动接受通知类事件；带有外部副作用、上下文披露、扇出或继续委托的动作必须拥有明确能力，并在策略要求时经过人工审批。

信封可以包含 `risk`、`requiresApproval`、`expiresAt`、`hopLimit`、`fanoutLimit`、`byteLimit` 和 `dedupeKey`。这些字段限制意外 Agent 消息的影响范围，但不会把消息文本自动变成执行权限。

## 给人和 Agent 的投影

语义 payload 是稳定的机器可读契约，包含类型化事实、稳定标识、状态、约束、上下文引用和可用动作。人类投影包含标题、简短解释、来源、状态和渐进展开的详情。人类 UI 必须能在不请求 Agent 重写的情况下从封面渲染消息。

Agent 可以请求有范围的详情引用，应当只收到当前决策所需的最小对象，而不是完整的人类页面。HTML、CSS 和 JavaScript 属于渲染问题，不能作为权限来源。

## 投递与阅读状态

协议区分 `accepted`、`delivered`、`presented`、`read`、`acknowledged` 和 `acted`。`delivered` 表示接收节点已经持久化信封；`presented` 表示客户端展示过相关消息；`read` 需要查看或明确标记动作。通知是本地副作用，不能证明消息已读。

已读标记应当按设备和会话单调前进。客户端可以维护不广播的本地已读标记。回执必须带上会话、设备、事件水位和协议版本。

## 示例结构

```json
{
  "id": "msg_01J...",
  "kind": "collaboration.request",
  "cover": {
    "title": "Rust/WASM WebSocket 评审",
    "preview": "请确认是否委派建议的评审人",
    "actor": { "kind": "agent-delegated", "id": "agent:linko" },
    "status": "needs-human-approval"
  },
  "semantic": {
    "intent": "request",
    "contextRefs": ["ctx_123"],
    "availableActions": ["approve", "reject", "inspect"]
  },
  "bodyRef": { "scheme": "linko", "objectId": "sha256:..." },
  "surfaceRef": { "scheme": "linko", "surfaceId": "surface_456", "version": 3 },
  "policy": { "risk": "medium", "requiresApproval": true, "expiresAt": "..." },
  "seal": { "contentHash": "sha256:...", "signature": "..." }
}
```

## 验收证据

- 正文所在节点离线时，客户端仍然可以使用封面显示收件箱行。
- 人类、受委托 Agent、自主 Agent 和系统事件在存储与 UI 中可区分。
- 重复投递只产生一条规范消息和多次投递尝试，不产生多个收件箱项目。
- 回执不能修改原始消息，也不能授予权限。
- 人在审批 Agent 消息前可以查看它引用的上下文和动作。
