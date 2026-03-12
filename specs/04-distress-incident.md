# Distress And Incident Spec

## 1. 目标

建立从求救到结案赔付的可验证闭环：
- 求救可提交
- 响应可质押
- 证据可追溯
- 裁决可审计
- 赔付可执行

## 2. 流程

1. 玩家触发 `POST /distress`
2. 系统广播 `intel.threat`
3. 响应者接单并提交 `ResponderBond`
4. Incident 聚合 KillMail 与证据哈希
5. auditor/insurer 通过后执行赔付

## 3. 关键对象

- `DistressBeacon`
- `ResponderBond`
- `IncidentCase`

## 4. 反刷与风控（强制）

### 4.1 Distress 提交

- 限流：`3 req/min/character`, `20 req/hour/alliance`
- 幂等键：同 `Idempotency-Key` 不重复建 beacon
- 去重窗口：同 `character + system` 30s 内合并
- 可选最小押金门槛，防止零成本 spam

### 4.2 响应提交

- 同一 responder 对同 beacon 只能质押一次
- 重复提交返回 `RESPONDER_ALREADY_JOINED`
- 仅 `OPEN/CLAIMED` 状态可接单

## 5. 证据标准

最小证据字段：
- `beacon_id`
- `killmail_ref`（可空）
- `evidence_hashes[]`
- `sourceEventRange`
- `operator_comment`
- `resolved_at_ms`

要求：
- 每个 evidence 项须可映射到链上 digest 或 walrus hash
- 证据追加为 append-only，不允许覆盖历史 hash

## 6. 裁决与赔付权限

- `auditor`：提交裁决 `CONFIRMED/REJECTED`
- `insurer`：执行赔付
- 推荐门限：`auditor + insurer` 双角色通过后才执行 payout

### 6.1 KillMail 数据来源

#### 6.1.1 GraphQL 查询

```graphql
query GetKillMails($characterId: String!, $timeRange: TimeRange!) {
  killMails(
    filter: {
      victim: { characterId: $characterId }
      timestamp: $timeRange
    }
    orderBy: TIMESTAMP_DESC
    first: 10
  ) {
    edges {
      node {
        killMailId
        victimCharacterId
        victimShipTypeId
        attackers {
          characterId
          shipTypeId
          damageDealt
        }
        solarSystemId
        timestamp
        totalValue
        txDigest     # 链上交易哈希
      }
    }
  }
}
```

#### 6.1.2 实时订阅

```typescript
// gRPC 或 WebSocket 订阅
interface KillMailSubscription {
  type: 'KillMail';
  filters: {
    solarSystems?: string[];    // 监控的星系
    allianceIds?: string[];     // 监控的联盟
  };
}

// 收到事件后自动关联到 OPEN 状态的 Incident
```

#### 6.1.3 关联逻辑

```
KillMail 收到
    ↓
匹配 victim.characterId 到 OPEN Incident
    ↓
验证 timestamp 在 Incident 窗口内
    ↓
附加 killmail_ref 到 IncidentCase
    ↓
Incident 状态转为 EVIDENCE_ATTACHED
```

### 6.2 双角色审批实现（Two-Phase Commit）

#### 6.2.1 状态机扩展

```
EVIDENCE_ATTACHED
    │
    ├── auditor 确认 ──> AUDITOR_APPROVED
    │                        │
    │                        └── insurer 确认 ──> CONFIRMED
    │                                                │
    │                                                └── 执行 payout
    │
    └── auditor 拒绝 ──> REJECTED
```

#### 6.2.2 链上实现

```move
public struct IncidentCase has key {
    id: UID,
    // ...
    auditor_approved: bool,
    auditor_approved_at: Option<u64>,
    auditor_address: Option<address>,
    insurer_approved: bool,
    insurer_approved_at: Option<u64>,
    insurer_address: Option<address>,
}

public entry fun auditor_approve(
    incident: &mut IncidentCase,
    acl: &AppAclTable,
    ctx: &TxContext,
) {
    // 验证调用者有 AUDITOR 角色
    assert!(has_role(acl, tx_context::sender(ctx), ROLE_AUDITOR), E_UNAUTHORIZED);
    assert!(!incident.auditor_approved, E_ALREADY_APPROVED);
    
    incident.auditor_approved = true;
    incident.auditor_approved_at = option::some(clock::timestamp_ms(clock));
    incident.auditor_address = option::some(tx_context::sender(ctx));
    
    // 发出事件
    event::emit(AuditorApproved { incident_id: object::id(incident) });
}

public entry fun insurer_approve_and_payout(
    incident: &mut IncidentCase,
    reward_pool: &mut RewardPool,
    acl: &AppAclTable,
    payout_plan: vector<PayoutItem>,
    ctx: &mut TxContext,
) {
    // 验证调用者有 INSURER 角色
    assert!(has_role(acl, tx_context::sender(ctx), ROLE_INSURER), E_UNAUTHORIZED);
    // 必须 auditor 先批准
    assert!(incident.auditor_approved, E_AUDITOR_NOT_APPROVED);
    assert!(!incident.insurer_approved, E_ALREADY_APPROVED);
    
    incident.insurer_approved = true;
    incident.insurer_approved_at = option::some(clock::timestamp_ms(clock));
    incident.insurer_address = option::some(tx_context::sender(ctx));
    
    // 执行赔付
    execute_payout(incident, reward_pool, payout_plan, ctx);
}
```

#### 6.2.3 审批超时处理

- Auditor 审批超时：48 小时无操作自动升级到联盟管理员
- Insurer 审批超时：24 小时无操作可由 Governor 强制执行
- 所有超时操作记录审计日志

## 7. 赔付规则

强校验：
- `payouts.length == amounts.length`
- `sum(amounts) <= reward_pool`
- 同 `incident_id` 只能执行一次 payout

失败策略：
- 任一 payout 失败则整体回滚
- 保留 `payout_plan_hash` 便于重放审计

## 8. 指标

- distress 到首次响应 P95
- incident 结案时长 P95
- 误报率
- payout 成功率
- 证据缺失率

## 9. 版本迭代

- V1：单联盟闭环
- V2：跨联盟协作 + 条约分账
- V3：保险池 + 信誉分层 + 自动保额建议
