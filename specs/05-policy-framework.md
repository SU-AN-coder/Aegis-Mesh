# Policy Framework

## 1. 目标

对联盟设施行为实现可配置、可回滚、可审计的策略治理，并与 ACL 权限模型一致。

## 2. 策略字段

- `mode`: `ceasefire | blockade | wartime`
- `tollBase`
- `riskMultiplier`
- `civilianProtection`
- `treatyExemptions[]`
- `redlist[]`
- `whitelist[]`

## 3. 执行优先级

1. 条约豁免（treatyExemptions）
2. whitelist 放行
3. redlist 拦截
4. mode 全局规则
5. civilianProtection 兜底规则

## 4. 权限与审批

### 4.1 角色要求

- 策略提案：`operator`
- 高风险字段批准：`auditor`（可选再加 `treaty_admin`）
- 紧急回滚：`operator + auditor`

### 4.2 高风险字段

以下字段变更必须走双人审批：
- `mode`
- `riskMultiplier`
- `treatyExemptions`

## 5. 变更流程

1. `POLICY_CHANGE_PROPOSED`
2. `POLICY_CHANGE_APPROVED`
3. `POLICY_UPDATED`

每次变更必须记录：
- 操作者地址
- 角色位图
- 变更前后 diff
- requestId
- sourceSnapshotId

## 6. 回滚机制

- 每个 `policyId` 保留最近 N 版快照（建议 N=20）
- 支持按版本号一键回滚
- 回滚同样走审计事件：`POLICY_ROLLED_BACK`

## 7. 前端交互要求

`apps/web/components/policy-editor.tsx` 需补齐：
- dry-run（只算影响不落链）
- 冲突检测（他人并发修改）
- 风险预估（对 quote 与 gate 放行率的影响）

## 8. 验收点

- 同一联盟策略切换后 5 秒内可体现在 route quote
- 所有高风险字段变更均可追溯到双角色批准记录
- 回滚路径可在 1 次操作内完成
