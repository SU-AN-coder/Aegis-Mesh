# Route Sponsorship Spec

## 1. 目标

让玩家在高风险航线中低摩擦完成：
- 风险评估
- 路线报价
- 赞助通行
- 与官方 Gate / JumpPermit 语义一致的放行

## 2. 最小闭环

`PLAYER_ENTERED_RANGE -> /route/quote -> sponsored jump -> RoutePassIssued (app) -> tx digest submitted -> JumpPermit confirmed (official tx/object changes)`

## 3. 路由数据来源（必须 live）

报价引擎输入必须来自官方 live universe：
- GraphQL：Gate/Policy/Node 当前状态
- 事件流：KillMail、Distress、Reward、PolicyUpdated
- gRPC 增量流：最近窗口风险变动

输出字段：
- `sourceSnapshotId`
- `sourceEventRange`
- `dataFreshnessMs`

## 4. 报价模型

`quote = base_toll * risk_multiplier * peak_factor + sponsor_fee`

其中：
- `base_toll`: 来自 Policy `tollBase`
- `risk_multiplier`: 来自策略 + live 热度
- `peak_factor`: 拥塞与冲突时段因子
- `sponsor_fee`: 赞助服务费

返回必须包含可解释性：
- `riskBreakdown[]`
- `tollBreakdown[]`
- `blockedByPolicy[]`

## 5. 官方 JumpPermit 对齐

### 5.1 官方 permit 生成

- JumpPermit 必须通过官方 `gate::issue_jump_permit(source_gate, destination_gate, ...)` 生成。
- 不定义自定义 JumpPermit 结构。

### 5.2 业务元数据位置

以下字段放在 `RoutePass` 或链下索引，不写入官方 JumpPermit：
- `quoted_cost`
- `quoted_risk`
- `sponsor_scope`
- `route_fingerprint`

### 5.3 route_fingerprint 规则

- 作为业务追踪键，不作为官方 permit 校验字段。
- 仅用于“报价 -> 赞助 -> 审计”关联。

## 6. 赞助执行模式（修正版）

### 6.1 官方标准操作（优先）

对官方游戏操作（如 Gate 跳跃）：
- 前端必须接入官方 `@evefrontier/dapp-kit` Provider 与钱包连接。
- 若目标动作为官方 SDK 已内置的 sponsored action，优先使用官方能力。
- 若目标动作为 Aegis Mesh world bridge 自定义 Move 调用，则使用官方钱包连接 + 自建 sponsor / bridge 执行路径。

### 6.2 自定义业务操作

对 Aegis Mesh 自定义业务（非官方标准交易）：
- 可使用自建 Sponsor 服务。
- 必须启用 `Idempotency-Key`、预算闸门和审计日志。

### 6.3 Sponsored Transaction 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                  官方 dapp-kit 赞助路径                      │
└─────────────────────────────────────────────────────────────┘

┌─────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────┐
│ Overlay │────>│  Aegis API   │────>│   dapp-kit   │────>│  Sui    │
│  前端   │     │   /sponsor   │     │   sponsor    │     │  链上   │
└─────────┘     └──────────────┘     └──────────────┘     └─────────┘
     │                 │                    │                  │
     │ 1. 用户触发赞助  │                    │                  │
     │    跳跃请求      │                    │                  │
     │─────────────────>│                    │                  │
     │                 │ 2. 验证策略/白名单  │                  │
     │                 │    构建 bridge payload│                 │
     │                 │────────────────────>│                  │
     │                 │                    │ 3. sponsor签名   │
     │                 │                    │    用户签名      │
     │                 │                    │────────────────>│
     │                 │                    │                 │ 4. 执行交易
     │                 │                    │                 │    发放JumpPermit
     │                 │                    │<────────────────│
     │                 │                    │ 5. txDigest     │
     │                 │<───────────────────│                  │
     │                 │ 6. 记录审计日志    │                  │
     │<────────────────│    返回 digest     │                  │
     │ 7. 显示成功     │                    │                  │
     │    记录证据     │                    │                  │
     └─────────────────┴────────────────────┴──────────────────┘

关键节点说明：
- 步骤 2：Aegis API 执行业务逻辑（策略检查、报价验证、RoutePass 创建）
- 步骤 3：前端使用官方 dapp-kit 钱包会话拉起 EVE Vault，或由 sponsor 服务执行 bridge 交易
- 步骤 4：Sui 链上验证所有签名并执行 gate::issue_jump_permit()
- 步骤 6：API 先记录 txDigest，再由 indexer 通过官方交易块 / object changes 确认 JumpPermit 创建
```

### 6.4 交易数据流转

```typescript
// 请求体
interface SponsorRouteRequest {
  pass_id: string;          // 已报价的 RoutePass ID
  character_id: string;
  source_gate_id: string;
  dest_gate_id: string;
  location_proof?: string;  // Base64 编码的 LocationProof
  idempotency_key: string;
}

// 响应体
interface SponsorRouteResponse {
  tx_digest?: string;       // 已拿到时立即返回
  permit_expires_at: number;
  route_pass_status: 'await_wallet_signature' | 'pending_chain_confirmation' | 'confirmed' | 'failed';
  audit_id: string;         // 可追溯的审计 ID
}
```

## 7. 失败语义

必须区分并可重试：
- `INVALID_ROUTE_LINKING`
- `POLICY_DENIED`
- `SPONSOR_BUDGET_EXCEEDED`
- `RATE_LIMITED`
- `UPSTREAM_DATA_STALE`
- `SPONSORED_TX_PROVIDER_UNAVAILABLE`

## 8. 指标与验收

- `/route/quote` P95 < 200ms
- 官方赞助路径成功率 >= 98%
- 自建赞助路径成功率 >= 97%
- quote 与链上实际结算偏差 <= 1%
- RoutePass 与链上 JumpPermit 的创建确认可全量关联，即使官方模块不发专门 PermitIssuedEvent。
