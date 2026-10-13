# Linko 本地节点 MVP

[English](README.md) | 中文

这是第一个可运行的本地节点。它使用一个 TypeScript 进程和一个 SQLite 数据库。

## 运行

\`\`\`sh
pnpm node:start
pnpm node:smoke
pnpm contract:smoke
\`\`\`

节点默认只监听回环地址的 \`8787\` 端口。可以用 \`LINKO_PORT\`、\`LINKO_DB\` 和 \`LINKO_NODE_ID\` 调整本地进程。浏览器预览默认使用 \`http://127.0.0.1:8477\`；节点使用默认端口时，请用 \`?api=http://127.0.0.1:8787\`。

## MVP 契约

MVP 支持不可变本地信封、由规范内容生成的事件 ID、重复投递尝试、SQLite WAL 事务、游标拉取、按设备的展示/已读/确认事实和审批状态转移。跨包 smoke 会让真实节点响应经过真实 Web UI parser。

REST 游标拉取是持久路径。WebSocket 唤醒提示、Peer 配对、签名、多节点授权和 E2EE 有意推迟。节点会在 \`/v1/node\` 中如实声明；这个包是本地状态原型，不是可信网络服务。
