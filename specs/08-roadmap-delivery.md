# Roadmap And Delivery

## 1. 目标

在 3 周内将项目升级为可冲击总榜的提交包，重点补齐：
- 去中心化权限
- 关键接口安全
- 官方 live 数据绑定
- Stillness 实机证据
- 文明叙事与评审表达

## 2. 第 1 周：协议与权限

交付：
1. 完成 `01`、`02`、`03` 的编码对齐。
2. 上线 ACL + 角色位图（operator/auditor/insurer/treaty_admin）。
3. RoutePass + JumpPermit 语义收口，覆盖 route_hash 与 linking。

验收：
- 敏感接口全部通过 ACL 检查。
- 路由正反向 hash 一致测试通过。

## 3. 第 2 周：事件闭环与 live 绑定

交付：
1. 完成 `04`、`05`、`06` 核心实现。
2. distress -> incident -> payout 闭环打通。
3. API 明确接入官方 GraphQL/gRPC/事件流。

验收：
- distress 到 ops 可见延迟 < 3s。
- incident 证据可追溯到官方 digest。

## 4. 第 3 周：安全、证据、叙事

交付：
1. 完成 `07` 安全与观测落地。
2. 产出 Stillness 实机证据包。
3. 完成 `09` 评审叙事脚本与项目简介。

验收：
- `/distress`、`/sponsor/route` 限流与幂等生效。
- Sponsor 密钥安全策略与轮换演练文档齐全。

## 5. 评审映射

1. Utility
- 玩家真实解决“通行、求救、协防、赔付”问题。

2. Technical
- ACL 权限、事件可追溯、官方 live 数据绑定、并发可扩展对象模型。

3. Creative
- 互助条约 + 文明底线治理，不只是战斗效率工具。

4. Live Integration
- Stillness 实机视频 + digest + 数据源绑定证据。

## 6. 提交包清单

1. 项目简介（100-200 字）
2. 架构图 + 协议对象图
3. Live 数据流图（GraphQL/gRPC/事件）
4. 5-8 分钟实机视频（非纯 Sim）
5. 至少 3 条链上交易哈希与链接
6. 安全与权限说明（ACL、限流、幂等、密钥）
7. 文明叙事页（互助条约与底线规则）
