# Security And Observability

## 1. 安全目标

- 防越权
- 防滥用
- 防重放
- 可追责
- 可恢复

## 2. 重点威胁

1. `/distress`、`/sponsor/route` 被刷
2. 自建 Sponsor 密钥泄漏（仅自定义业务路径）
3. 策略误改或恶意改
4. 假事件驱动错误链上写入

## 3. 赞助安全模型（按路径区分）

### 3.1 官方标准操作（Gate 等）

- 优先使用 `@evefrontier/dapp-kit` 内置赞助。
- 不维护本地 Sponsor 私钥，不重复造轮子。
- 重点控制：调用频率、幂等、预算与审计。

### 3.2 自定义业务赞助（可选）

仅当交易不属于官方标准赞助路径时启用：
- 私钥不落业务进程内存，不落磁盘明文。
- 使用独立签名服务（KMS/HSM 或托管签名器）。
- 业务服务仅持签名请求权限。

运营策略：
- Key 分层：`hot key` / `warm key`
- 轮换：至少每 30 天
- 泄漏演练：吊销、预算冻结、流量切断

## 4. 限流与反刷

### 4.1 通用策略

- 维度：`IP + actor + alliance + action`
- 算法：令牌桶 + 滑动窗口
- 触发后返回 `429` + `retryAfterMs`

### 4.2 关键接口

- `/sponsor/route`：预算闸门 + 幂等强制
- `/distress`：重复系统去重 + 频次门限 + 最小押金

## 5. 幂等与一致性

- 幂等表唯一键：`(actor, endpoint, idempotency_key)`
- 写入链上前先预占幂等记录，完成后更新 `tx_digest`
- 超时重试必须复用同 key

## 6. 审计日志

关键字段：
- `timestamp`
- `requestId`
- `actor`
- `role_bits`
- `alliance_id`
- `action`
- `result`
- `tx_digest`
- `source_snapshot`

要求：
- 策略变更、裁决、赔付必须全链路可追溯。

## 7. 可观测性指标

- API 成功率
- 关键接口 P95
- sponsor 成功率（官方/自定义分开统计）
- distress 到响应时延
- websocket 在线数与重连时延
- rate-limit 命中率

## 8. SLO 建议

- API 可用性 >= 99.5%
- 官方赞助成功率 >= 98%
- 自定义赞助成功率 >= 97%
- distress 首响应 P95 <= 3s
- WebSocket 重连恢复 <= 5s

## 9. 故障演练

- dapp-kit 赞助不可用降级演练
- 自定义签名服务不可用演练
- 官方数据源延迟/中断演练
- 错误策略发布后一键回滚
- 恶意刷接口触发保护阈值验证
