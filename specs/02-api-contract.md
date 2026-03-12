# API Contract

## 1. 基础

- Base URL: `http://localhost:4000`
- Content-Type: `application/json`
- WebSocket: `ws://localhost:4000/intel-stream`

## 2. 鉴权与身份

### 2.1 鉴权方式

- 管理端与敏感接口使用 Wallet 签名会话（推荐）或 JWT。
- Header:
  - `Authorization: Bearer <token>`
  - `X-Alliance-Id: <alliance_id>`
  - `X-Actor-Address: <sui_address>`

### 2.2 角色注入

网关层从链上/缓存 ACL 解析 `role_bits`，并传递给业务层：
- `X-Role-Bits`
- `X-Role-Scope`

## 3. 幂等与防重放

所有写接口必须支持：
- `Idempotency-Key`（必填，UUID v4）
- `X-Request-Timestamp`（毫秒）
- `X-Request-Signature`（可选，服务间）

幂等存储约束：
- key 唯一键：`(actor, endpoint, idempotency_key)`
- TTL：24h
- 同 key 重试返回首个成功结果或确定性错误

## 4. 限流与防刷（重点）

### 4.1 `/sponsor/route`

- 维度：`IP + actor + alliance + character`
- 默认：`10 req/min/character`, `60 req/min/alliance`
- 预算闸门：`daily_sponsor_budget_per_alliance`
- 触发保护：
  - 连续失败超过阈值进入冷却窗口
  - 风险异常时返回 `429 SPONSOR_GUARD_TRIGGERED`

### 4.2 `/distress`

- 维度：`IP + actor + character + system`
- 默认：`3 req/min/character`, `20 req/hour/alliance`
- 同系统重复 beacon 去重窗口：30s
- 触发保护：
  - 高频重复请求自动降级为“更新现有 beacon”
  - 可选验证码或链上小额押金提高攻击成本

## 5. 端点合同

1. `GET /health`
2. `GET /nodes`
3. `GET /route/quote?from=&to=&mode=safe|cheap|fast`
4. `POST /sponsor/route`
5. `GET /beacons`
6. `POST /distress`
7. `GET /incidents`
8. `GET /incidents/:id`
9. `POST /incident/attach`
10. `GET /policies/:id`
11. `PUT /policies/:id`
12. `GET /intel`

## 6. Sponsor 接口适用范围（修正版）

- 官方标准操作（如 Gate 跳跃）优先走 dapp-kit 内置赞助。
- `POST /sponsor/route` 定位为“自定义业务赞助入口”，用于补充官方标准路径之外的交易。
- 文档与实现都必须在响应中标记：
  - `sponsorProvider = dapp-kit|custom`

## 7. 统一错误模型

```json
{
  "errorCode": "SPONSOR_GUARD_TRIGGERED",
  "message": "Sponsor flow is temporarily throttled",
  "requestId": "req_01H...",
  "retryAfterMs": 12000
}
```

必备错误码：
- `UNAUTHORIZED`
- `FORBIDDEN_ROLE`
- `RATE_LIMITED`
- `IDEMPOTENCY_CONFLICT`
- `SPONSOR_BUDGET_EXCEEDED`
- `INVALID_ROUTE_LINKING`
- `DISTRESS_DUPLICATED`
- `POLICY_NOT_FOUND`

## 8. 官方 Live Universe 数据绑定

> 必须明确对接官方数据，而非仅消费本地 mock。

### 8.1 数据源

- Sui GraphQL（对象读取、事件查询）
- Sui gRPC/流式事件（低延迟增量）
- Move 事件流（KillMail、Policy、Distress、Reward）

### 8.2 绑定规则

- `/route/quote` 输入必须包含最近窗口的官方事件快照版本号（`sourceSnapshotId`）。
- `/incidents/:id` 返回必须可追溯到官方链上 `digest`/`eventSeq`。
- `/intel` 消息必须带 `dataSource = official_live` 或 `dataSource = simulated`。

## 9. WebSocket 语义

消息结构：

```json
{
  "sequence": 1024,
  "channel": "intel.policy",
  "kind": "policy",
  "headline": "Policy switched to blockade",
  "createdAt": "2026-03-09T12:00:00Z"
}
```

约束：
- `sequence` 单调递增
- 支持 `lastSequence` 断线补偿
- 客户端必须识别乱序并丢弃旧包

## 10. 审计要求

所有写接口必须落审计：
- `requestId`
- `actor`
- `role_bits`
- `alliance_id`
- `idempotency_key`
- `source_snapshot`
- `result`
