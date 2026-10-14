# Linko 本地节点 MVP

[English](README.md) | 中文

本包运行一个带 SQLite 持久化的 Linko 节点。本地 HTTP API 只监听回环地址。配对节点使用独立 HTTPS 监听器、固定证书指纹和每个 Peer 的 bearer secret；TLS 只保护传输，不提供端到端加密。

## 运行单个节点

```sh
pnpm node:start
pnpm node:smoke
pnpm node:recovery-smoke
pnpm contract:smoke
```

本地 API 默认监听 `127.0.0.1:8787`。可用 `LINKO_PORT`、`LINKO_DB`、`LINKO_NODE_ID` 和 `LINKO_ALLOWED_ORIGINS` 调整本地设置。

## 本地实时提示

本地节点默认提供 `ws://127.0.0.1:8787/v1/live`。客户端必须来自允许的 Origin，发送 `{ "type": "hello", "protocolVersion": "v1" }`，并等待 `ready`。节点随后在本地状态可能变化时发送小型 `hint` 消息。提示不包含消息正文，不拥有队列或游标，也可能丢失或重复；客户端通过 `GET /v1/sync` 恢复。配对 Peer 的 WSS 投递仍是后续传输阶段。

## 运行两个配对节点

为每个节点生成证书（真实部署请使用适合部署名称和 IP 的 CA；下面命令用于本地双节点检查）：

```sh
mkdir -p .linko
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' \
  -keyout .linko/node-a.key -out .linko/node-a.crt
openssl x509 -in .linko/node-a.crt -noout -fingerprint -sha256
```

为每个节点创建仅所有者可读的配置（`chmod 600 .linko/peers.json`）。`certSha256` 可以带冒号或不带冒号，`bearerSecret` 是与接收节点共享的随机值：

```json
{
  "peers": [
    {
      "peerId": "node-b",
      "label": "节点 B",
      "endpoint": "https://127.0.0.1:8788",
      "certSha256": "AA:BB:…:FF",
      "bearerSecret": "replace-with-a-random-secret"
    }
  ]
}
```

分别给两个进程设置独立 DB、节点 ID、TLS 文件和 Peer 配置。只有同时设置两个 TLS 路径时才会启用 HTTPS 监听器：

```sh
LINKO_DB=.linko/a.sqlite LINKO_NODE_ID=node-a LINKO_PEERS_FILE=.linko/peers-a.json \
LINKO_TLS_KEY=.linko/node-a.key LINKO_TLS_CERT=.linko/node-a.crt \
LINKO_PORT=8787 LINKO_PEER_PORT=8788 pnpm node:start
```

`GET /v1/peers` 只返回 `peerId` 和 `label`。`POST /v1/send` 接受 `{peerId,envelope,clientId,commandId}`，在一个事务中写入本地副本和 outbox，使用有界指数退避最多重试同一个事件 ID 八次，并在重启后继续命令去重。预算耗尽的项目会显示为 `abandoned`；显式使用新的 command 可以让同一事件重新排队。`GET /v1/outbox` 返回投递状态和尝试次数。接收方只接受经过认证的 HTTPS Peer 入口；该监听器不会暴露本地管理 API。

## MVP 契约

`GET /v1/sync` 返回扁平 UI 信封。其不透明游标覆盖到达、回执/动作变化以及 outbox 变化，并限定在 SQLite 日志 epoch 内。`POST /v1/receipts` 接受 `presented`、`read`、`acknowledged`、`approved` 或 `rejected`；批准会校验请求的动作和过期时间，本里程碑中 approved/rejected 决策不可逆。不可变信封不能携带 `facts` 声明；节点从自己的持久化行投影这些事实。

已批准的 [2026 年传输方向](../../docs/decisions/0010-wss-live-session-and-recovery.zh.md) 选择 WSS 作为在线实时会话，REST 游标同步与 SQLite/outbox 继续负责规范恢复。WSS 在线实时会话、签名和消息层 E2EE 不在本 MVP 范围内。HTTPS 配对认证显式配置的 Peer 通道，不能回退为明文或 TOFU。

`pnpm node:recovery-smoke` 会用临时 SQLite 数据库和自签名 HTTPS Peer 启动两个真实节点进程。它在接收节点持久化事件、尚未返回确认时强制结束发送节点，随后重启并检查 outbox 重试以及对端仍只有一条事件；同时重启接收节点，在一次已读变化后从原游标继续拉取，并检查两个节点收敛到同一组事件。fixture 只使用默认未设置的 `LINKO_TEST_PEER_ACK_DELAY_MS`，用于把强制退出边界稳定地放在对端持久化之后。
