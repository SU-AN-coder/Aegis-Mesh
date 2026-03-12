# Overlay And Live Integration

## 1. 目标

确保 Aegis Mesh 在游戏内浮层完成可验证闭环，且能证明数据来自官方 live universe，而非本地模拟。

## 2. 运行模式

1. `Live Mode`
- 事件源：游戏客户端桥 + 官方链上数据源。
- 用于最终评审。

2. `Sim Mode`
- 事件源：本地模拟按钮。
- 仅用于开发与容灾演示，不可作为最终 live 证据。

UI 必须明确显示当前模式。

## 3. 事件桥协议

输入事件：
- `PLAYER_ENTERED_RANGE`
- `PLAYER_LEFT_RANGE`
- `DISTRESS_SHORTCUT`
- `SYSTEM_CHANGED`

输出事件：
- `OVERLAY_OPENED`
- `ROUTE_PASS_SUCCESS`
- `DISTRESS_SUBMITTED`
- `INCIDENT_READY`

### 3.1 postMessage 数据结构

#### 3.1.1 TypeScript 接口定义

```typescript
// 基础事件结构
interface GameBridgeEvent<T extends string, P = unknown> {
  source: 'eve-frontier' | 'aegis-mesh';
  type: T;
  payload: P;
  timestamp: number;        // Unix ms
  correlationId?: string;   // 用于请求-响应关联
}

// 输入事件 Payload
interface PlayerEnteredRangePayload {
  characterId: string;
  gateId: string;
  solarSystemId: string;
  distance: number;         // 与 Gate 的距离（米）
}

interface PlayerLeftRangePayload {
  characterId: string;
  gateId: string;
  reason: 'moved_away' | 'jumped' | 'docked' | 'disconnected';
}

interface DistressShortcutPayload {
  characterId: string;
  solarSystemId: string;
  threatType?: 'COMBAT' | 'BLOCKADE' | 'UNKNOWN';
}

interface SystemChangedPayload {
  characterId: string;
  fromSystemId: string;
  toSystemId: string;
  viaGateId?: string;
}

// 输出事件 Payload
interface OverlayOpenedPayload {
  mode: 'live' | 'sim';
  panelType: 'route' | 'distress' | 'intel';
}

interface RoutePassSuccessPayload {
  passId: string;
  txDigest: string;
  sourceGateId: string;
  destGateId: string;
  quotedCost: number;
}

interface DistressSubmittedPayload {
  beaconId: string;
  characterId: string;
  systemId: string;
  txDigest?: string;
}

interface IncidentReadyPayload {
  incidentId: string;
  beaconId: string;
  status: 'OPEN' | 'EVIDENCE_ATTACHED' | 'AUDITOR_APPROVED';
}
```

#### 3.1.2 消息发送与接收

```typescript
// 发送到游戏客户端
function postToGame(event: GameBridgeEvent<string, unknown>) {
  window.parent.postMessage(event, '*');  // 实际部署时使用具体 origin
}

// 从游戏客户端接收
window.addEventListener('message', (event: MessageEvent) => {
  // 验证来源
  if (!isValidGameOrigin(event.origin)) return;
  
  const gameEvent = event.data as GameBridgeEvent<string, unknown>;
  if (gameEvent.source !== 'eve-frontier') return;
  
  switch (gameEvent.type) {
    case 'PLAYER_ENTERED_RANGE':
      handlePlayerEntered(gameEvent.payload as PlayerEnteredRangePayload);
      break;
    case 'DISTRESS_SHORTCUT':
      handleDistressShortcut(gameEvent.payload as DistressShortcutPayload);
      break;
    // ...
  }
});
```

#### 3.1.3 事件验证规则

| 字段 | 验证规则 |
|------|----------|
| `source` | 必须为已知来源 |
| `type` | 必须为已定义事件类型 |
| `timestamp` | 必须在 30 秒内 |
| `correlationId` | 响应事件必须匹配请求 |
| `characterId` | 必须与当前登录角色一致 |

#### 3.1.4 错误处理

```typescript
interface GameBridgeError {
  source: 'aegis-mesh';
  type: 'ERROR';
  payload: {
    code: 'INVALID_EVENT' | 'UNAUTHORIZED' | 'TIMEOUT' | 'INTERNAL';
    message: string;
    originalEventType?: string;
    correlationId?: string;
  };
  timestamp: number;
}
```

## 4. Stillness 环境连接配置（必填）

> 以下变量写入 `.env`，并在演示时展示实际值（可打码地址中段）。

- `NEXT_PUBLIC_SUI_NETWORK=stillness`（或官方当前测试网络名）
- `NEXT_PUBLIC_SUI_RPC_URL=<official rpc url>`
- `NEXT_PUBLIC_SUI_GRAPHQL_URL=<official graphql url>`
- `NEXT_PUBLIC_API_BASE_URL=<your aegis api>`
- `NEXT_PUBLIC_CHAIN_EXPLORER_BASE=<official explorer base>`

前置检查：
1. 钱包可连接到 Stillness 网络。
2. GraphQL 查询可返回最新区块高度。
3. Overlay 能从游戏桥接收到 `PLAYER_ENTERED_RANGE`。

## 5. 测试账户与资产准备

1. 准备角色
- `operator`（策略管理）
- `pilot`（触发通行/求救）
- `responder`（接单响应）

2. 准备资产
- 每个账户持有足够 SUI（gas 与最小押金）。
- pilot 角色可访问至少一条可链接 Gate 路径。

3. 准备权限
- operator 拥有相关设施 `OwnerCap` 或可借用权限。
- sponsor 路径已在 `AdminACL` 中授权。

## 6. 官方 live 数据绑定（强制）

### 6.1 数据采集路径

- 官方 GraphQL：对象与历史事件拉取
- 官方 gRPC/实时流：低延迟增量事件
- 合约事件订阅：RoutePass、Distress、Incident、Policy

### 6.2 证明字段

每个 overlay 关键动作必须记录：
- `sourceSnapshotId`
- `sourceEventRange`
- `chainDigest`
- `blockHeight`
- `timestamp`
- `dataSource=official_live|simulated`

## 7. digest 获取与验证方法

### 7.1 获取

从三处获取同一交易 digest：
1. 前端交易回执（dapp-kit 返回）
2. 后端审计日志（requestId 对应 txDigest）
3. 链上查询（GraphQL/RPC/explorer）

### 7.2 验证

- 校验 digest 在官方 explorer 可打开。
- 校验交易时间戳与视频时间线一致。
- 校验事件中 `alliance_id/character_id` 与演示角色一致。

## 8. Stillness 实机证据包（评审最关键）

最终提交必须包含：

1. 实机录像（5-8 分钟）
- 游戏内浮层从触发到成功完整流程
- 不允许全程 Sim Mode

2. 交易证据
- 至少 3 条 Stillness 真实链上 digest
- 对应 explorer 链接与时间戳

3. 数据源证据
- GraphQL/gRPC 实时订阅截图或日志
- 展示 `official_live` 数据标签

4. 双端一致性证据
- overlay 操作结果与 ops 面板状态一致截图

## 9. 演示脚本（建议）

1. 玩家进入范围 -> 浮层打开 -> 拉取 live quote
2. 使用 dapp-kit 赞助跳跃 -> 返回 digest
2.1 API 将 digest 先登记为 `pending_chain_confirmation`
2.2 Indexer 通过官方 transaction block/object changes 确认 JumpPermit 创建
3. 玩家触发 distress -> ops 面板出现 beacon
4. 审计员更新 incident -> overlay 收到 `INCIDENT_READY`

## 10. 常见故障与降级

- 游戏桥不可用：自动切 Sim 并显式提示“非 live 证据”。
- API 不可达：显示最后一次有效报价与数据新鲜度。
- WebSocket 断开：指数退避重连并显示离线标识。
- 官方数据源超时：标记 `dataSource=stale` 并禁止录制评审证据片段。
