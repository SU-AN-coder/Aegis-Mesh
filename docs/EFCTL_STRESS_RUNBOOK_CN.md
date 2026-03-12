# Aegis Mesh `efctl` 压测执行手册

更新时间：2026-03-12

本手册用于在官方本地沙盒或指定测试环境中，对 Aegis Mesh 的事件链路进行高频压测。

## 1. 目标

验证以下链路在事件洪峰下仍然稳定：

1. `RoutePassIssued` 相关 API 写路径
2. `DistressRaised` 相关 API 写路径
3. API 审计日志与 indexer 交易确认链路
4. `/intel-stream` 广播与 Ops 面板读链路

## 2. 前置条件

执行前请确认：

1. `contracts/world-integration-template` 已按 Stillness 或本地 world-contracts 环境配置完成
2. API 已使用 `.env` 启用 indexer
3. `LIVE_DATA_MODE` 已切到对应环境
4. `efctl` 能够正常连接本地或官方沙盒

建议最小 `.env`：

```bash
INDEXER_ENABLED=true
INDEXER_POLL_INTERVAL_MS=2000
LIVE_DATA_MODE=official_live
SUI_RPC_URL=<sandbox_or_stillness_rpc>
SUI_GRAPHQL_URL=<sandbox_or_stillness_graphql>
AEGIS_WORLD_BRIDGE_PACKAGE_ID=<bridge_package_id>
WORLD_SERVER_REGISTRY_ID=<server_registry_id>
WORLD_CLOCK_OBJECT_ID=0x6
```

## 3. 压测场景

### 场景 A：RoutePass 高并发

目标：

1. 连续创建大量 `/sponsor/route` 请求
2. 提交批量 permit digest
3. 观察 RoutePass 是否从 `pending_chain_confirmation` 稳定收敛到 `confirmed`

关注指标：

1. `/metrics` 中 `sponsorAttempts`、`sponsorSuccess`
2. `/indexer/status` 中 `pendingRoutePasses`
3. `/audit` 中 `txDigest` 是否持续落库

### 场景 B：Distress 高频抬升

目标：

1. 在多个 system 内快速触发 `/distress`
2. 验证去重窗口不会误吞跨系统请求
3. 验证 `/intel-stream` 能持续推送 threat 消息

关注指标：

1. `/metrics` 中 `distressRaised`、`distressDeduped`
2. `/beacons` 是否能持续返回新 beacon
3. WebSocket 是否无明显断流

### 场景 C：混合流量

目标：

1. sponsor/route 与 distress 同时打流
2. 观察 API P95、rate limit 和 indexer 健康度

关注指标：

1. `/metrics.endpointP95`
2. `/live/status`
3. `/indexer/status`

## 4. 推荐执行步骤

### 4.1 启动服务

```bash
npm run dev:api
npm run dev:web
```

### 4.2 启动 `efctl` 沙盒

按官方文档启动本地世界合约环境，并记录：

1. RPC URL
2. GraphQL URL
3. world package ID
4. server registry shared object ID

### 4.3 RoutePass 压测

建议分三轮：

1. 10 次串行 sponsor route
2. 50 次并发 sponsor route
3. 100 次并发 sponsor route + digest 提交

每轮后记录：

1. 成功数
2. 失败数
3. `pendingRoutePasses` 峰值
4. 最终 `confirmed` 数量

### 4.4 Distress 压测

建议分三轮：

1. 同一角色、同一系统重复提交，验证 dedupe
2. 同一角色、不同系统并发提交，验证不会误 dedupe
3. 多角色并发提交 + responder 接单

每轮后记录：

1. `distressRaised`
2. `distressDeduped`
3. WebSocket 广播是否持续

## 5. 通过标准

满足以下条件可视为通过：

1. API 在压测期间不崩溃，无持续 5xx
2. indexer 不出现长期积压，`pendingRoutePasses` 能回落
3. RoutePass 不出现永久卡在 `pending_chain_confirmation` 的大面积堆积
4. distress 请求的去重仅发生在同角色同系统时间窗内
5. `/intel-stream` 在高压下仍可推送关键消息

## 6. 建议保存的证据

压测结束后保存：

1. `/metrics` JSON 截图或导出
2. `/indexer/status` 截图
3. API 终端日志
4. 至少一组成功确认的 RoutePass digest
5. 一组 distress 高频提交日志

## 7. 备注

官方 `world::gate::issue_jump_permit` 当前不会发专门的 PermitIssued 事件。

因此 Aegis Mesh 的闭环确认以：

1. 交易块成功
2. `objectChanges` 中创建 `::gate::JumpPermit`

作为 RoutePass 最终确认依据。
