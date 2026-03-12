# Aegis Mesh 黑客松现状分析报告

更新时间：2026-03-11

## 1. 结论摘要

`Aegis Mesh` 当前已经是一个完成度较高的比赛原型：

- 本地代码可测试、可构建、可演示
- 产品方向和黑客松主题 `A Toolkit for Civilization` 高度匹配
- Utility 和 Technical Merit 两个评分类目具备竞争力

但它还不是“当前即可冲奖”的状态。最核心的差距不是功能缺失，而是：

- 真实 `Stillness`/官方 live 证据不足
- world-contracts 真集成尚未落成最终提交物
- Web 端自动化验证不足
- 最终视频与链上 digest 证据尚未收集

一句话判断：

> 当前状态：强原型，未完成最终提交闭环。  
> 冲奖概率：中等偏低。  
> 完成 live 证据闭环后：可提升到中高。

## 2. 2026-03-11 实测结果

本次已完成以下实际检查：

```bash
npm run check:all
http://localhost:4000/health
http://localhost:4000/live/status
http://localhost:3000/
http://localhost:3000/overlay
```

结果：

- API 测试通过：15/15
- Shared 测试通过：1/1
- API 本地服务启动成功，`/health` 返回 `200`
- Web 本地服务启动成功，首页与 `/overlay` 返回 `200`
- `live/status` 显示当前仍为 `simulated`
- `hasOfficialBinding=false`
- `indexer` 仍未启用

本轮新的实际风险：

- `npm run check:all` 没有全绿结束
- 阻塞点不是业务代码，而是 `sui move test` 在拉取 `MystenLabs/sui` 依赖时发生网络重置
- 这说明当前 Move 检查对外部网络稳定性仍有依赖，比赛前需要避免临场因网络波动失去验证能力

当前工程状态可以定义为：

- `local-dev-ready`: 是
- `demo-ready`: 基本是
- `submission-ready`: 否
- `award-ready`: 否

## 3. 项目当前优势

### 3.1 题目契合度高

项目不是单点玩法，而是围绕“文明基础设施”构建：

- 安全通行
- 遇险求救
- 事件裁决
- 策略治理
- 浏览器与游戏内双界面协同

这和黑客松主题高度一致，比单纯做一个小游戏工具更像“世界级基础设施模块”。

### 3.2 工程结构清晰

当前仓库已经形成较完整的分层：

- `contracts/aegis_mesh`：协议对象和事件
- `apps/api`：HTTP + WebSocket + live/indexer 适配
- `apps/web`：`ops` 与 `overlay`
- `packages/shared`：共享类型

这种结构对评审很友好，因为它体现了可扩展性与可维护性。

### 3.3 安全与运营意识明显

当前 API 已包含：

- 幂等
- 限流
- 预算限制
- 审计日志
- 角色位图
- 官方权限对象校验入口

这部分会明显提升 `Technical Merit` 评分。

## 4. 当前短板

### 4.1 最大短板：Live Integration 证据不足

当前证据文件显示项目还停留在模拟态：

- `docs/stillness-evidence/latest.md` 仍为 `simulated`
- `hasOfficialBinding=false`
- 尚无 3 条已验证链上 digest
- `live/status` 中 `rpcHealthy=false`、`graphqlHealthy=false`、`grpcHealthy=false`

这会直接影响：

- Technical Merit
- Polish
- 评审可信度

### 4.2 world-contracts 真桥接还未成为已验证成果

仓库已经提供：

- `contracts/world-integration-template`

这很好，但当前它更像“准备好的集成模板”，还不是“已成功对接的比赛证据”。

### 4.3 Web 测试仍偏弱

目前 Web 包没有真正的测试覆盖，意味着：

- 演示前最后改动风险较高
- Overlay 与 Ops 的关键交互缺少回归保护

### 4.4 Move 验证链路受网络波动影响

今天的统一检查已经暴露出一个新问题：

- 本地 `sui move test` 并不是每次都能稳定执行
- 当 `.move` 依赖缓存不完整或需要重新拉取时，会受 GitHub 网络状态影响

这不代表合约逻辑坏了，但它意味着比赛最后阶段必须尽量避免把“首次拉依赖”留到临场。

### 4.5 交付叙事还需要再聚焦

当前项目内容很多，优点是丰富，风险是分散。  
比赛提交时必须把主故事收束为一个强闭环，而不是把所有模块平均讲一遍。

## 5. 当前是否具备获奖潜力

### 5.1 现在直接提交

判断：**不建议**

原因：

- 缺乏 live 证据
- 缺少链上 digest 证明
- 最终演示闭环尚未固化

这种状态更像“优秀开发中项目”，不是“强提交”。

### 5.2 完成当前冲刺后再提交

判断：**有明显获奖机会**

前提是以下 4 件事全部完成：

1. 真实 Stillness/官方 live 数据绑定成功
2. 至少 3 条链上 digest 可验证
3. 视频中完整演示 Sponsor + Distress + Incident/Payout
4. 讲清楚为什么它是“文明工具箱”而非普通工具集

### 5.3 最可能冲击的维度

- `Utility`
- `Technical Merit`

`Creativity` 不是弱项，但要靠叙事强化。  
当前最该做的不是继续扩很多新功能，而是把已有功能做成“可信的、可验证的、能说服评审的闭环”。

## 6. 本轮已完成的修复

本次冲刺已经直接修复或补强了以下内容：

- 新增统一自检命令：
  - `npm run test:contracts`
  - `npm run test:all`
  - `npm run check:all`
  - `npm run evidence:all`
- `.env.example` 增加证据相关示例变量
- 清理 Move 合约中的一批无效 alias / 未使用常量 warning
- 重写 `docs/FINAL_CLOSURE_TUTORIAL_CN.md`
- 新增本报告与个人操作手册
- 实测确认 API 与 Web 当前都能本地跑起来
- 实测确认当前 live 绑定仍处于模拟模式
- 实测暴露 Move 依赖拉取存在外网波动风险

## 7. 后续修改建议

### P0：必须在提交前完成

1. 接通官方 `Stillness` RPC / GraphQL / gRPC
2. 用真实钱包完成 `dapp-kit` 执行
3. 让 `docs/stillness-evidence/latest.md` 出现真实 live 状态
4. 生成并验证至少 3 条真实 digest
5. 录制最终视频
6. 在本机提前跑通一次完整 `sui move test` 缓存，避免比赛当天受外网波动影响

### P1：建议本周完成

1. 给 `apps/web` 增加最少一条关键路径测试
2. 固化 Overlay 演示流程，避免临场改代码
3. 清理剩余文档中不必要的歧义和旧说明
4. 给 Move 检查补一份“离线可复用缓存/预检说明”

### P2：加分项

1. 加强“条约 / 保险 / 文明底线”叙事
2. 用 1 张图讲清 Sponsor、Distress、Incident 三条主循环
3. 让评审能快速理解项目的差异化价值

## 8. 推荐提交叙事

建议把项目主线收束为：

> Aegis Mesh 是 EVE Frontier 的文明安全基础设施。  
> 它让联盟不仅能更安全地通行，还能在冲突发生时更快求救、更透明裁决、更稳定治理。

视频只围绕 3 条主路径：

1. Sponsor Route
2. Distress Beacon
3. Incident To Payout

这样最有利于评审理解和记住项目。

## 9. 最终判断

当前项目不是“没戏”，恰恰相反，它的底子很好。  
真正决定你能不能拿奖的，不再是再多写几个页面，而是：

- 把 live 证据做实
- 把闭环录下来
- 把故事讲清楚

只要这三件事补齐，`Aegis Mesh` 就从“强原型”进入“可冲奖提交”区间。

## 10. 今天的项目现状

如果只基于今天的实测结果来描述，最准确的表述是：

- 代码主干可运行
- API 与 Web 可启动
- 本地展示链路可工作
- 比赛闭环尚未进入真实 `official_live`
- 最关键的剩余工作已经从“写功能”转向“拿真实证据”

所以从项目阶段上看，当前更像：

> 工程开发后期，证据冲刺前夜。  
> 不是继续无边界扩功能，而是集中突破 live、digest、视频、提交物。
