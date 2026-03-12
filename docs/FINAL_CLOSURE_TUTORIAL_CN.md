# Aegis Mesh 最终闭环教程

这份教程只做一件事：帮助你把当前项目从“本地可运行原型”推进到“可提交、可验证、可录制”的黑客松版本。

## 1. 当前代码已经完成的部分

- 本地工程可通过 `npm run check:all`
- API 已具备幂等、限流、预算闸门、风控冷却、审计日志
- Move 合约已覆盖节点注册、策略快照、RoutePass、Distress、Incident 主路径
- Web 已提供 `ops` 与 `overlay` 两个界面
- 证据脚本已提供：
  - `npm run evidence:stillness`
  - `npm run evidence:verify-digests`

## 2. 当前还不算“可提交”的关键原因

- `docs/stillness-evidence/latest.md` 目前仍是 `simulated`
- 还没有 3 条以上真实链上 digest
- 还没有基于官方 world-contracts 的真实扩展发放流程
- 还没有最终录制视频与提交素材包

## 3. 你应该先跑的统一检查

```bash
npm install
npm run check:all
```

如果要单独验证 Move：

```bash
npm run test:contracts
```

## 4. Stillness 闭环最短路径

### 4.1 配置环境变量

参考仓库根目录下的 `.env.example`，最少需要补齐：

```bash
LIVE_DATA_MODE=official_live
SUI_RPC_URL=<stillness_rpc_url>
SUI_GRAPHQL_URL=<stillness_graphql_url>
SUI_GRPC_URL=<stillness_grpc_health_url>
SUI_GRPC_EVENTS_URL=<stillness_grpc_event_stream_url>

NEXT_PUBLIC_SUI_NETWORK=stillness
NEXT_PUBLIC_SUI_RPC_URL=<stillness_rpc_url>
NEXT_PUBLIC_SUI_GRAPHQL_URL=<stillness_graphql_url>
NEXT_PUBLIC_CHAIN_EXPLORER_BASE=<official_explorer_base>
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000

REQUIRE_OFFICIAL_ACL=true
REQUIRE_GOVERNOR_CAP_FOR_ADMIN_ACL=true
NEXT_PUBLIC_OWNER_CAP_ID=<owner_cap_object_id>
NEXT_PUBLIC_ADMIN_ACL_ID=<admin_acl_object_id>
```

### 4.2 准备三类角色

- `operator`：策略与设施管理
- `pilot`：通行与求救触发
- `responder`：接单与响应

### 4.3 打通 world-contracts 模板

模板目录：

- `contracts/world-integration-template/Move.toml.template`
- `contracts/world-integration-template/sources/aegis_world_bridge.move.template`
- `contracts/world-integration-template/README.md`

需要完成：

1. 复制 `Move.toml.template` 为 `Move.toml`
2. 固定 Stillness 所用 `world-contracts` commit
3. 填入真实 `world` 与 `aegis_mesh` 地址
4. 将桥接模板重命名为 `.move`
5. 执行真实构建与发布

### 4.4 接入真实 dapp-kit 钱包执行

当前前端已经具备动态适配器：

- `apps/web/components/dapp-kit-adapter.ts`

你需要把官方钱包 Provider 接进 Web，然后让 `overlay` 页面返回真实 digest，而不是仅返回待执行 payload。

### 4.5 产出证据

执行：

```bash
npm run evidence:all
```

最终你需要在以下文件看到真实结果：

- `docs/stillness-evidence/latest.md`
- `docs/stillness-evidence/digest-verify-latest.md`

## 5. 最终验收标准

满足以下条件才算进入“可提交”状态：

1. `hasOfficialBinding=true`
2. 至少 3 条真实 digest 能被脚本验证
3. Sponsor、Distress、Incident/Payout 三条主链路都跑通
4. 录制出 5 分钟内可复现的视频

## 6. 配套文档

- 状态分析报告：`docs/HACKATHON_STATUS_REPORT_CN.md`
- 你本人必须完成的事项：`docs/PERSONAL_ACTION_RUNBOOK_CN.md`
