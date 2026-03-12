# Aegis Mesh 个人必做操作手册

这份文档只列出一类事情：

> 必须由你本人亲自完成，无法仅靠当前本地代码自动替代的操作。

更新时间：2026-03-11

## 1. 注册与外部资源获取

### 1.1 黑客松报名与提交入口

你本人需要完成：

1. 在黑客松官网完成报名
2. 确认团队信息、项目名称、公开仓库地址
3. 最终在官网完成项目提交

### 1.2 获取官方网络与生态资源

你本人需要从官方渠道确认并记录：

1. `Stillness` 或比赛指定测试网络的 RPC
2. GraphQL 地址
3. gRPC 或事件流地址
4. 官方 Explorer 地址
5. 官方 world-contracts 对应 commit 或发布地址

这些信息通常来自：

- 官方文档
- 官方 Discord
- Hackathon 页面或公告

## 2. 钱包、账号与资产

### 2.1 准备角色账号

你本人需要准备至少 3 个地址：

1. `operator`
2. `pilot`
3. `responder`

### 2.2 领取测试资产

你本人需要：

1. 连接比赛指定网络
2. 使用 faucet 或官方发币流程领取测试资产
3. 确保 3 个地址都有足够 gas
4. 确保 `pilot` 与 `responder` 有业务资金和押金

建议最低准备：

- 每个地址至少 `0.2 ~ 0.5 SUI`
- `pilot` / `responder` 至少 `5 SUI` 级别业务资金

### 2.3 获取真实权限对象

你本人必须确认并记录这些链上对象 ID：

1. `OwnerCap`
2. `AdminACL`
3. `GovernorCap`（若启用强校验）

原因：

- API live 模式下会校验这些对象是否真实存在
- 对象 owner 必须匹配你的请求身份

## 3. `.env` 真实配置

你本人需要根据官方资源补全 `.env`。

重点变量：

```bash
LIVE_DATA_MODE=official_live
SUI_RPC_URL=<official_rpc>
SUI_GRAPHQL_URL=<official_graphql>
SUI_GRPC_URL=<official_grpc_health>
SUI_GRPC_EVENTS_URL=<official_grpc_event_stream>

NEXT_PUBLIC_SUI_NETWORK=stillness
NEXT_PUBLIC_SUI_RPC_URL=<official_rpc>
NEXT_PUBLIC_SUI_GRAPHQL_URL=<official_graphql>
NEXT_PUBLIC_CHAIN_EXPLORER_BASE=<official_explorer>
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000

REQUIRE_OFFICIAL_ACL=true
REQUIRE_GOVERNOR_CAP_FOR_ADMIN_ACL=true
NEXT_PUBLIC_OWNER_CAP_ID=<owner_cap_id>
NEXT_PUBLIC_ADMIN_ACL_ID=<admin_acl_id>

EVIDENCE_OPERATOR_ADDRESS=<operator_address>
EVIDENCE_PILOT_ADDRESS=<pilot_address>
EVIDENCE_RESPONDER_ADDRESS=<responder_address>
```

## 4. world-contracts 真实发布

当前仓库只提供了模板，无法替你完成真实链上发布。

你本人需要：

1. 确认官方 `world-contracts` 版本
2. 填写 `contracts/world-integration-template/Move.toml`
3. 调整桥接模板 ABI
4. 使用真实钱包或 CLI 账号发布合约
5. 记录发布后的 Package ID

这是 Live Integration 的关键步骤之一。

## 5. 官方钱包与真实签名

你本人需要完成：

1. 安装并连接比赛要求的钱包
2. 确认钱包工作在正确网络
3. 完成真实签名弹窗测试
4. 用真实 `dapp-kit` 路径拿到 digest

这一步不能只靠本地 mock 替代，因为评审看的是链上真实交易结果。

## 6. 实机联调

你本人需要亲自验证：

1. 游戏桥接或 WebView 事件是否真实进入 Overlay
2. `PLAYER_ENTERED_RANGE` 是否会自动打开浮层
3. Sponsor Route 是否能拿到真实 digest
4. Distress 是否能在 Ops 面板实时出现
5. Incident 审批后是否能形成完整 payout 证据链

## 7. 证据采集

你本人必须亲自收集以下提交物：

### 7.1 链上证据

至少 3 条真实 digest，且满足：

1. 可在 Explorer 打开
2. 可被 `npm run evidence:verify-digests` 验证
3. 能与审计日志、视频时间线对应

### 7.2 视频

你本人必须录制最终演示视频。建议控制在 5 分钟以内。

建议脚本：

1. 展示当前为 `official_live`
2. Pilot 进入范围，Overlay 打开
3. 赞助通行并展示真实 digest
4. Pilot 触发 distress
5. Responder 接单
6. Ops 面板附加 incident / 审批 / payout
7. 最后在 Explorer 打开至少 3 条 digest

### 7.3 截图与补充材料

你本人需要准备：

1. Overlay 截图
2. Ops 截图
3. Explorer 截图
4. `docs/stillness-evidence/latest.md`
5. `docs/stillness-evidence/digest-verify-latest.md`

## 8. 提交前最终检查

提交前请亲自确认以下事项全部完成：

1. `npm run check:all`
2. `npm run evidence:all`
3. `docs/stillness-evidence/latest.md` 不再是 `simulated`
4. 已生成至少 3 条真实 digest
5. GitHub 仓库公开可访问
6. 演示视频可正常播放
7. 提交页面中填写的链接全部有效

## 9. 你现在最该优先做的事

按优先级排序：

1. 获取官方 RPC / GraphQL / gRPC / Explorer
2. 准备 3 个真实地址与测试资产
3. 配置 `.env`
4. 完成 world-contracts 真实桥接发布
5. 打通真实钱包签名
6. 生成 3 条 digest
7. 录视频
8. 提交官网

## 10. 今天开始的执行清单

如果你今天就开始推进，建议按下面顺序做：

### 今日第 1 轮

1. 确认比赛官网报名状态
2. 拿到官方 RPC / GraphQL / gRPC / Explorer
3. 准备 `operator` / `pilot` / `responder` 三个地址
4. 领取测试资产

### 今日第 2 轮

1. 填写 `.env`
2. 确认钱包连接到正确网络
3. 记录 `OwnerCap` / `AdminACL` / `GovernorCap`
4. 验证 API 不再停留在纯模拟配置

### 今日第 3 轮

1. 完成一次真实 sponsor digest
2. 完成一次真实 distress digest
3. 完成一次真实 incident 或 payout digest
4. 运行 `npm run evidence:all`

## 11. 你本人需要特别注意的风险

1. 不要把视频录制留到最后一天
2. 不要把链上 digest 收集留到最后一天
3. 不要在比赛当天第一次跑 world-contracts 发布
4. `sui move test` 依赖外网拉取缓存时可能受网络波动影响，最好提前在本机跑顺一次

## 12. 说明

代码、脚本、测试、报告这些事情我可以继续帮你一起推进。  
但账号、钱包、领币、报名、视频录制、最终提交通常必须由你本人亲自完成。  
这份手册的作用，就是把“必须你亲手完成”的部分从代码工作里明确剥离出来。
