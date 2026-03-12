# Protocol Design

## 1. 目标

Aegis Mesh 是面向 EVE Frontier 多联盟协作的安全与物流协议层，覆盖：
- 通行赞助
- 求救响应
- 事件裁决
- 赔付分发
- 动态策略治理

核心要求：
- 与官方权限体系兼容（OwnerCap / AdminACL / GovernorCap）。
- 与官方 Gate/JumpPermit 语义一致。
- 高并发下对象模型可扩展。

## 1.5 Extension 注册模式（关键）

Aegis Mesh 合约作为 Gate/Turret/StorageUnit 的 Extension 接入游戏世界：

### 1.5.1 Witness 类型定义

```move
/// Aegis Mesh 扩展身份凭证
public struct AegisMeshAuth has drop {}
```

### 1.5.2 Extension 注册流程

```
1. 部署 Aegis Mesh 合约 → 获得 Package ID
2. 从 Character 借用设施 OwnerCap
3. 调用 gate::authorize_extension<AegisMeshAuth>(gate, owner_cap)
4. 归还 OwnerCap
5. 设施现在信任 AegisMeshAuth 类型的调用
```

### 1.5.3 赞助跳跃调用示例

```move
public entry fun sponsored_jump(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // 1. 业务验证（策略、白名单等）
    // ...
    
    // 2. 调用官方接口发放 JumpPermit
    gate::issue_jump_permit(
        source_gate,
        destination_gate,
        character,
        AegisMeshAuth {},  // Witness 凭证
        expires_at_ms,
        ctx,
    );
}
```

### 1.5.4 Move.toml 依赖配置

```toml
[package]
name = "aegis_mesh"
version = "0.1.0"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "mainnet" }
world-contracts = { git = "https://github.com/evefrontier/world-contracts.git", rev = "<specific_commit>" }

[addresses]
aegis_mesh = "0x0"
world = "<world_package_id>"
```

> 注意：`<specific_commit>` 和 `<world_package_id>` 需在 Stillness 部署时更新为实际值。

## 2. 对象模型（V2，替代大一统根对象）

> 旧模型 `AllianceMesh` 单根对象仅保留兼容读接口，不再承载高频写路径。

1. `MeshRegistry`（共享对象）
- 全局入口，仅存索引与版本信息。
- 字段：`version`, `alliance_index`, `app_acl_root`, `config_root`。

2. `AllianceRegistry`（每联盟一个共享对象）
- 按 `alliance_id` 分片，承载联盟级索引。
- 字段：`node_index`, `policy_index`, `route_pass_index`, `beacon_index`, `incident_index`。

3. `NodeRegistration`（子对象）
- 设施注册信息：`node_kind`, `assembly_id`, `policy_id`, `position_hash`。

4. `PolicyProfile`（子对象）
- 策略快照：`mode`, `toll_base`, `risk_multiplier_bps`, `civilian_protection`, `lists`。

5. `RoutePass`（子对象）
- 赞助与报价的业务对象（非 JumpPermit）。
- 字段：`route_fingerprint`, `expires_at_ms`, `quoted_cost`, `quoted_risk`, `sponsor_scope`, `source_snapshot_id`。

6. `DistressBeacon`（子对象）
- 求救与押金状态：`status`, `bond_pool`, `responder_index`, `opened_at_ms`。

7. `IncidentCase`（子对象）
- 取证与裁决：`killmail_ref`, `evidence_hashes`, `verdict`, `payout_plan_hash`。

8. `AppAclTable`（共享对象）
- 应用层 ACL：`subject -> role_bits`，按 `global`/`alliance` scope。
- 注意：该表是官方权限之上的叠加层，不替代官方权限。

### 2.5 对象存储结构详解

#### RoutePass 存储

```move
// 存储在 AllianceRegistry 内
public struct AllianceRegistry has key {
    id: UID,
    // ...
    route_passes: Table<ID, RoutePass>,  // pass_id -> RoutePass
}

public struct RoutePass has store {
    pass_id: ID,
    alliance_id: ID,
    character_id: ID,
    route_fingerprint: vector<u8>,    // 业务追踪键
    quoted_cost: u64,
    quoted_risk: u64,
    sponsor_scope: u8,
    source_snapshot_id: vector<u8>,   // 报价时的数据快照
    issued_at_ms: u64,
    expires_at_ms: u64,
    consumed: bool,                    // 是否已使用
    linked_permit_digest: Option<vector<u8>>,  // 关联的官方 JumpPermit 交易 digest
}
```

- **生命周期**：有效期内可查询，过期后可被清理（或归档）
- **查询方式**：通过 `pass_id` 直接索引
- **关联追溯**：`linked_permit_digest` 字段记录实际 JumpPermit 交易

#### PolicyProfile 版本快照

```move
public struct PolicyHistory has store {
    current_version: u64,
    snapshots: VecDeque<PolicySnapshot>,  // 保留最近 20 版
}

public struct PolicySnapshot has store, copy, drop {
    version: u64,
    profile: PolicyProfile,
    changed_by: address,
    changed_at_ms: u64,
    change_reason: String,
}
```

- **快照获取**：`get_policy_version(policy_id, version)` 返回历史快照
- **回滚操作**：`rollback_policy(policy_id, target_version)` 恢复到指定版本
- **清理策略**：超过 20 版时自动移除最旧快照

## 3. 权限模型（官方权限基座 + 应用层 ACL）

### 3.1 官方权限基座（必须）

1. 设施级权限
- 使用 `OwnerCap<T>` + Character Borrow/Return 模式控制设施管理。

2. 赞助与服务器验证权限
- 使用 `AdminACL` 控制服务端级赞助与验证路径。
- 通过 `GovernorCap` 管理 `AdminACL` 生命周期和授权变更。

### 3.2 应用层 ACL（可选叠加）

角色位图：
- `ROLE_OPERATOR = 1 << 0`
- `ROLE_AUDITOR  = 1 << 1`
- `ROLE_INSURER  = 1 << 2`
- `ROLE_TREATY_ADMIN = 1 << 3`

作用：
- 仅用于应用内治理语义（审计、保险、条约审批）。
- 不能绕过官方 OwnerCap/AdminACL 检查。

### 3.3 关键操作权限映射

- `register_node` / `set_policy`
  - 必须通过 `OwnerCap` 检查。
  - 可叠加 `ROLE_OPERATOR`。

- `sponsor_route` / sponsor 验签路径
  - 必须通过 `AdminACL`（由 `GovernorCap` 管理）。

- `resolve_incident`
  - 推荐 `ROLE_AUDITOR`，并保留官方管理员兜底。

- `execute_payout`
  - 推荐 `ROLE_INSURER + ROLE_AUDITOR` 双角色门限。

## 4. 状态机

### 4.1 Beacon

- `OPEN -> CLAIMED -> RESOLVED`
- `OPEN -> EXPIRED`

约束：
- `OPEN/CLAIMED` 才可追加响应者。
- `RESOLVED/EXPIRED` 禁止写入响应和追加赔付计划。

### 4.2 Incident

- `PENDING -> CONFIRMED | REJECTED`

约束：
- 同一 `incident_id` 仅可创建一次。
- 裁决后必须写 `resolved_at_ms`。
- `CONFIRMED` 才允许进入 `execute_payout`。

## 5. 原生 Gate 与 JumpPermit 语义（修正版）

### 5.1 JumpPermit 来源

- `JumpPermit` 必须由官方 `gate::issue_jump_permit(source_gate, destination_gate, ...)` 生成。
- 不自定义 JumpPermit 结构，不向官方 JumpPermit 注入业务扩展字段。

### 5.2 赞助元数据承载位置

以下字段不能写入官方 JumpPermit：
- `quoted_cost`
- `quoted_risk`
- `sponsor_scope`
- 自定义 `route_hash`

这些元数据应放在：
- 链上 `RoutePass`（业务扩展对象），或
- 链下 API / 索引数据库（带 digest 追溯）。

### 5.3 route_hash / route_fingerprint 约束

- 不强制覆盖或替代官方内部路由语义。
- 在确认官方允许前，仅使用 `route_fingerprint` 作为业务层关联键。
- `route_fingerprint` 不参与官方 JumpPermit 验证，仅用于报价、审计、可观测性关联。

### 5.4 linking 与跨联盟约束

跨联盟通行必须同时满足：
- 官方 Gate linking 检查通过。
- 双方策略允许或存在条约豁免。
- 赞助路径通过 `AdminACL` 验证与风控。

## 5.5 临近性证明（LocationProof）

部分操作需要玩家"到场"才能执行，通过 LocationProof 机制验证。

### 5.5.1 原理

```
玩家靠近 Gate
    ↓
游戏服务器检测到临近性
    ↓
服务器签发 LocationProof（Ed25519 签名）
    ↓
上链操作携带 LocationProof
    ↓
合约验证签名有效性
```

### 5.5.2 适用场景

| 场景 | LocationProof 要求 |
|------|--------------------|
| Distress 求救 | 必须（防止远程刷求救） |
| Gate 赞助跳跃 | 必须（玩家必须在 Gate 附近） |
| 响应者接单 | 可选（视业务需求） |
| 策略变更 | 不需要（管理操作） |

### 5.5.3 验证接口

```move
use world::location_proof;

public fun verify_proximity(
    proof: &LocationProof,
    character: &Character,
    target_assembly: &Gate,
    admin_acl: &AdminACL,
    clock: &Clock,
) {
    location_proof::verify(
        proof,
        character,
        target_assembly,
        admin_acl,
        clock,
    );
}
```

### 5.5.4 API 集成

- `/sponsor/route` 请求体包含 `locationProof` 字段
- `/distress` 请求体包含 `locationProof` 字段
- 后端验证签名后再组装上链交易

## 6. 事件标准

基础事件（保留）：
- `NodeRegistered`
- `PolicyUpdated`
- `RoutePassIssued`
- `DistressRaised`
- `ResponderAccepted`
- `KillmailLinked`
- `IncidentResolved`
- `RewardPaid`

新增事件（治理）：
- `RoleGranted`
- `RoleRevoked`
- `PolicyChangeProposed`
- `PolicyChangeApproved`

## 7. 迁移策略

1. Phase A：并行写
- 新写路径写入 `AllianceRegistry + child objects`。
- 旧 `AllianceMesh` 只读镜像。

2. Phase B：权限切换
- 去除 `mesh.operator == sender` 硬编码。
- 引入 OwnerCap/AdminACL 检查。

3. Phase C：应用层 ACL 叠加
- 在官方权限之上启用角色位图策略。

## 8. 验收标准

- 任一敏感路径都可证明“先过官方权限，再过应用层治理权限”。
- JumpPermit 全部来自官方接口，扩展字段不写入官方对象。
- RoutePass 与官方 JumpPermit 的关联可通过 digest 与 timestamp 回溯。
