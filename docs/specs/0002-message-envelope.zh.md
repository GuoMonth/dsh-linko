# 0002 信封消息与会话语义

[English](0002-message-envelope.md) | 中文

状态：草案。

## 范围

Linko 消息是不可变信封，可以独立于某个 UI 被投递、存储、打开、引用和执行。信封支持人的简短消息、Agent 请求、证据、附件和受约束的人类界面。

## 信封组成

- **封面**：始终可用的轻量投影，用于收件箱。
- **正文引用**：内嵌内容或内容寻址的加密对象。
- **界面引用**：受约束、可重放的人类 UI 描述。
- **封印与策略**：参与者、受众、哈希、过期、委托和影响边界。

封面足以让人决定打开、延后、静音或审批，不必先拉取正文。较大内容在封面和策略落盘后再拉取。链接是引用，不是投递保证。

规范信封永不修改。投递、展示、已读、确认、审批和执行是独立事实或尝试，定义见[0005](0005-state-and-storage.zh.md)。后续回执不能重写作者，也不能授予权限。

## 作者类型

每个信封都标识创建它的参与者：

- `human`：人编写并发送；
- `agent-delegated`：在人类委托下编写或发送；
- `agent-autonomous`：依据 Agent 本地策略创建；
- `system`：节点为传输或同步生成。

作者、编写者、发送者和授权者仍是不同字段。签名证明某个密钥控制者对声明作者的绑定，不证明文字由人亲手输入。自主 Agent 消息绝不能渲染成人类作者消息。

## Agent 策略

第一版意图词汇为 `inform`、`suggest`、`request`、`delegate` 和 `command`。接收方可以自动接受通知型事件。外部副作用、上下文披露、扇出和继续委托需要明确能力，并可能要求人工审批。

风险、审批、过期、跳数、扇出和字节预算约束影响范围。客户端提供的 dedupe key 不再作为消息的第二身份；重试身份属于命令或投递尝试。策略字段不能把自然语言自动变成执行权限。

委托有自己的签名授予及撤销/过期事件。执行动作前，接收方要再次检查当前策略和委托。委托已过期的消息仍可审计，但不能产生新的副作用。

## 人类与 Agent 投影

稳定的语义 payload 面向机器，包含类型化事实、稳定标识、状态、约束、上下文引用和可用动作。人类投影包含标题、简短解释、来源、状态和渐进详情。封面必须能够在不请求 Agent 改写的情况下渲染。

Agent 可以请求有范围的详情引用，应只收到当前决策所需的最小对象。HTML、CSS 和 JavaScript 是渲染格式，不是权限来源。界面要么使用已知安全组件，要么当作惰性文本显示。

## 独立的投递与阅读事实

协议不使用一个状态枚举覆盖所有消息状态：

- 传输尝试可以是 queued、sending、confirmed、retry_wait、rejected 或 abandoned；
- 接收存储在持久提交后可以变为 `delivered`；
- 设备可以记录 `presented` 或 `read`；
- 人或有权 Agent 可以明确 `acknowledged`；
- 动作拥有自己的审批和执行尝试。

`confirmed` 是接收方观察，不是人的批准。`delivered` 不等于已读。`read` 不等于已确认。`acted` 是效果记录，可以在未读时发生。按设备保留事实；聚合只能说“已在一台设备阅读”，不能暗示“所有设备已读”。

私有已读标记使用本地会话位置。共享已读回执携带事件 ID 或验证过的参与者序号范围，有边界，并且只发给作者或约定的聚合方，不广播给群内所有成员。

## 示例结构

```json
{
  "id": "sha256:...",
  "kind": "collaboration.request",
  "cover": {
    "title": "评审建议的协作者",
    "preview": "请确认是否接受建议的评审人",
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
  "policy": {
    "risk": "medium",
    "requiresApproval": true,
    "expiresAt": "..."
  },
  "seal": { "contentHash": "sha256:...", "signature": "..." }
}
```

## 验收证据

- 正文持有节点离线时，收件箱仍可显示封面。
- 人类、受委托 Agent、自主 Agent 和系统作者可区分。
- 重复投递只产生一条规范消息和多次尝试。
- 回执不能改写信封或授予权限。
- 人在审批前能查看发送者、委托、受众、上下文和动作。
- UI 分别显示投递、已读、确认和动作事实。
