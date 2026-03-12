# Aegis Mesh Specs Index

本目录是 Aegis Mesh 的实施级规范，目标是让代码实现、评审材料、实机证据三条线统一口径。

## 文档目录

1. `01-protocol-design.md`
- 协议对象、状态机、ACL 权限、原生 Gate 语义与并发拆分。

2. `02-api-contract.md`
- HTTP/WebSocket 合同、鉴权、限流、幂等、错误码、官方数据绑定入口。

3. `03-route-sponsorship.md`
- 报价、赞助交易、RoutePass/JumpPermit 生命周期、跨联盟路由约束。

4. `04-distress-incident.md`
- 求救、响应、取证、裁决、赔付闭环与反刷策略。

5. `05-policy-framework.md`
- ceasefire/blockade/wartime 策略框架、执行优先级、变更审批。

6. `06-overlay-live-integration.md`
- 游戏内浮层协议、Stillness 实机证据包、Live/Sim 边界控制。

7. `07-security-observability.md`
- Sponsor 私钥安全、接口防刷、审计链路、SLO 与告警体系。

8. `08-roadmap-delivery.md`
- 三周交付排期、验收门槛、评审提交物。

9. `09-civilization-narrative.md`
- 评审叙事模板：互助条约、文明底线、工具箱价值。

## 当前版本重点补强

- 权限模型：从 `mesh.operator` 升级为 ACL + 角色位图。
- 数据绑定：明确接入官方 GraphQL/gRPC/事件流，避免“自循环 API”。
- Live 证据：补齐 Stillness 实机证据本体和提交清单。
- 对象模型：从单根对象拆为 registry + child objects，降低争用。
- Gate 语义：收口 `RoutePass / JumpPermit / route_hash / linking` 约束。
