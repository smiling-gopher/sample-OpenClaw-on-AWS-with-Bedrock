# PRD: Fargate Per-Employee Always-On Agent

> 每个员工两个 Agent：Serverless（默认免费）+ Always-On（Admin 开通，Fargate 容器）
> 员工自助接入 IM，Admin 全程可管控

---

## 1. Problem Statement

### Current State
- 所有员工共享 EC2 上一个 OpenClaw Gateway + 一个 IM bot
- IM 消息经过 H2 Proxy → Tenant Router → AgentCore microVM（4 次转发）
- AgentCore 冷启动 25s，Gateway 工具不可用 30s，Session Storage 导致身份丢失
- HEARTBEAT/主动推送不可用（microVM idle 后销毁）
- 共享 bot 屏蔽了 OpenClaw 原生的 IM 权限划分功能

### Target State
- 每个员工有两个独立 Agent：Serverless（走 AgentCore）+ Always-On（走 Fargate）
- Always-On Agent 是专属 Fargate 容器，Gateway 永远在线，IM 直连，HEARTBEAT 可用
- 员工在 Portal 自助配置 IM 连接（飞书/Telegram/Discord/Slack）
- Admin 完整管控：开通/关闭、IM 平台白名单、断开连接、审计日志
- 两个 Agent 数据完全隔离（SOUL 共享 Global/Position 层，Memory/Personal SOUL 独立）

---

## 2. Architecture

### 2.1 Per-Employee Container Model

```
ECS Cluster: {stack}-always-on
├── Service: ao-emp-daniel   → 1 container (Executive tier)
│   ├── OpenClaw Gateway (:18789) — 直连 Daniel 的飞书 bot
│   ├── server.py (:8080) — Guardrail + 审计 + /admin/* endpoints
│   ├── EFS Access Point: /emp-daniel (硬隔离)
│   ├── Task Role: executive-task-role
│   └── Security Group: executive-sg (允许公网出站)
│
├── Service: ao-emp-carol    → 1 container (Restricted tier)
│   ├── Gateway — 直连 Carol 的 Telegram bot
│   ├── EFS Access Point: /emp-carol
│   ├── Task Role: restricted-task-role (只读 S3/DDB)
│   └── Security Group: restricted-sg (禁止公网出站)
│
└── ...每个 always-on 员工一个 Service
```

### 2.2 两个 Agent 数据隔离

```
Serverless Agent (S3):
  s3://{bucket}/emp-daniel/workspace/
    ├── SOUL.md (Global + Position + Personal)
    ├── PERSONAL_SOUL.md
    ├── MEMORY.md
    ├── memory/
    └── output/

Always-On Agent (EFS):
  /mnt/efs/emp-daniel/workspace/
    ├── SOUL.md (Global + Position + Personal)
    ├── PERSONAL_SOUL.md ← 独立，可不同
    ├── MEMORY.md ← 独立
    ├── memory/ ← 独立
    └── output/

共享层（S3 _shared/）：
  ├── soul/global/SOUL.md ← 两个 Agent 都读
  ├── soul/positions/{pos}/SOUL.md ← 两个 Agent 都读
  └── skills/, knowledge/ ← 两个 Agent 都读
```

### 2.3 两条 IM 线路

```
线路 A — Serverless（所有员工默认有）：
  飞书 @acme_shared_bot → EC2 Gateway → H2 Proxy → Tenant Router → AgentCore microVM
  ├── 公司共享一个 bot，所有人用
  ├── 有冷启动，工具延迟
  └── 无 HEARTBEAT

线路 B — Always-On（Admin 开通的员工）：
  飞书 @daniel_ai_bot → Daniel 的 Fargate 容器 Gateway
  ├── Daniel 专属 bot，直连
  ├── 零冷启动，工具立即可用
  └── HEARTBEAT/主动推送可用

两条线完全独立。Daniel 在飞书看到两个 bot 可以聊。
```

---

## 3. Employee Flow

### 3.1 Portal "My Agents" Page

```
┌─────────────────────────────────────────────────────┐
│ My Agents                                           │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📦 Serverless Agent                    [Active] │ │
│ │ Model: MiniMax M2.5 (Standard tier)             │ │
│ │ Mode: On-demand, ~30s cold start                │ │
│ │ IM: via company shared bot @acme_bot            │ │
│ │ [Open Chat]                                     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🔒 Always-On Agent            [Not Configured]  │ │
│ │ Your administrator has not enabled this yet.    │ │
│ │ Contact your IT admin to request always-on.     │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Admin 开通后：**

```
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🚀 Always-On Agent                   [Running]  │ │
│ │ Model: Claude Sonnet 4.6 (Executive tier)       │ │
│ │ Mode: Always-on, instant response               │ │
│ │ Uptime: 3d 14h                                  │ │
│ │                                                 │ │
│ │ IM Connections:                                  │ │
│ │  飞书      Not Connected  [Connect]              │ │
│ │  Telegram  Not Connected  [Connect]              │ │
│ │  Slack     Not Connected  [Connect]              │ │
│ │                                                 │ │
│ │ [Open Chat]                                     │ │
│ └─────────────────────────────────────────────────┘ │
```

### 3.2 IM Connect Flow

**员工点 [Connect] 飞书：**

```
┌─────────────────────────────────────────────────┐
│ Connect 飞书 / Lark                              │
│                                                 │
│ Step 1: Create bot on Feishu Open Platform      │
│   → open.feishu.cn → Create Enterprise App      │
│   → Enable Bot capability                       │
│   → Set message webhook URL:                    │
│     (auto-filled, read-only)                    │
│     [https://xxx.awspsa.com/webhook/feishu/...] │
│   → Submit for enterprise admin approval        │
│                                                 │
│ Step 2: Enter credentials (after approval)      │
│   App ID:     [cli_xxxxxxxx      ]              │
│   App Secret: [••••••••••••••••  ]              │
│                                                 │
│ [Cancel]                    [Connect & Verify]  │
└─────────────────────────────────────────────────┘
```

**员工点 [Connect] Telegram：**

```
┌─────────────────────────────────────────────────┐
│ Connect Telegram                                 │
│                                                 │
│ Step 1: Create bot                              │
│   → Open Telegram → message @BotFather          │
│   → Send /newbot → follow instructions          │
│   → Copy the bot token                          │
│                                                 │
│ Step 2: Enter token                             │
│   Bot Token: [123456:ABC-DEF...]                │
│                                                 │
│ [Cancel]                    [Connect & Verify]  │
└─────────────────────────────────────────────────┘
```

**[Connect & Verify] 调用链：**

```
Portal → POST /api/v1/portal/agent/channels/add
  → Admin Console 验证 JWT + 检查 allowedIMPlatforms
  → 存凭证到 DynamoDB EMP#.imCredentials (KMS 加密)
  → POST http://{container}:8080/admin/channels/add
    → server.py subprocess: openclaw channels add --channel feishu --app-id xxx --app-secret xxx
    → 返回 success/fail
  → 写 AUDIT# (im_channel_connected)
  → Portal 显示 "飞书: Connected ✓"
```

### 3.3 Portal Chat Switcher

```
┌─────────────────────────────────────────┐
│ Chat  [Serverless ▾] [Always-On ●]     │
├─────────────────────────────────────────┤
│                                         │
│  Agent: Hi Daniel, I'm your always-on  │
│  assistant. Tools are ready. What can   │
│  I help with?                           │
│                                         │
│  You: Search the web for AWS re:Invent │
│                                         │
│  Agent: (instantly uses web_search)    │
│  Here are the latest updates...        │
│                                         │
└─────────────────────────────────────────┘
```

---

## 4. Admin Flow

### 4.1 Enable Always-On

```
Agent Factory → Daniel Kim → Deploy Mode
  ┌─────────────────────────────────────────┐
  │ Deploy Mode                              │
  │                                         │
  │ ● Serverless only (default, free)       │
  │ ○ Serverless + Always-On (~$7-16/mo)    │
  │                                         │
  │ Always-On Configuration:                │
  │   Tier: [Executive ▾]  (from position)  │
  │   Model: Claude Sonnet 4.6              │
  │   Guardrail: None                       │
  │   Resource: 0.5 vCPU / 1 GB (Executive) │
  │   Est. Cost: ~$27-47/month              │
  │                                         │
  │ [Save]                                  │
  └─────────────────────────────────────────┘
```

**[Save] 触发：**

1. DynamoDB `EMP#{emp_id}` 更新 `alwaysOnEnabled: true`
2. `efs.create_access_point(RootDirectory=/emp-daniel, PosixUser=1000)`
3. `ecs.register_task_definition(ao-emp-daniel)` — tier 模板 + emp_id env + Access Point + Role + SG
4. `ecs.create_service(ao-emp-daniel, desiredCount=1)`
5. 容器启动 → 从 S3 bootstrap MEMORY 到 EFS（首次迁移）
6. 写 AUDIT# (always_on_enabled)

### 4.2 IM Management Tab

```
Agent Factory → Daniel Kim → IM Management
  ┌─────────────────────────────────────────────────┐
  │ IM Connections                                   │
  │ ┌──────────┬───────────┬──────────┬────────────┐│
  │ │ Platform │ Status    │ Since    │ Action     ││
  │ ├──────────┼───────────┼──────────┼────────────┤│
  │ │ 飞書     │ Connected │ 2h ago   │[Disconnect]││
  │ │ Telegram │ —         │ —        │ —          ││
  │ │ Discord  │ Blocked   │ —        │ —          ││
  │ └──────────┴───────────┴──────────┴────────────┘│
  │                                                 │
  │ Allowed Platforms (per position: Executive):    │
  │   [✓ 飞書] [✓ Telegram] [✓ Slack] [✗ Discord]  │
  │                                                 │
  │ Audit:                                          │
  │  14:30 Daniel connected 飞書 (enterprise app)    │
  │  09:00 Admin enabled always-on (Executive tier) │
  └─────────────────────────────────────────────────┘
```

### 4.3 Security Center — Fargate Panel

```
Security Center → Fargate Agents
  ┌───────────────────────────────────────────────────┐
  │ Always-On Agents                     3 running    │
  │                                                   │
  │ ┌──────────┬──────┬────────────┬───────┬────────┐│
  │ │ Employee │ Tier │ Model      │Status │ Cost/mo││
  │ ├──────────┼──────┼────────────┼───────┼────────┤│
  │ │ Daniel   │ Exec │ Sonnet 4.6 │Running│ $12.72 ││
  │ │ Carol    │ Restr│ DeepSeek   │Running│ $8.50  ││
  │ │ Ryan     │ Eng  │ Sonnet 4.5 │Stopped│ $0     ││
  │ └──────────┴──────┴────────────┴───────┴────────┘│
  │                                                   │
  │ Total: $21.22/month (Bedrock + Fargate)           │
  │                                                   │
  │ [Stop All] [Restart All]                          │
  └───────────────────────────────────────────────────┘
```

---

## 5. Data Model Changes

### 5.1 DynamoDB

**EMP# record — 新增字段：**

```json
{
  "PK": "ORG#acme",
  "SK": "EMP#emp-daniel",
  "name": "Daniel Kim",
  "positionId": "pos-sa",
  "alwaysOnEnabled": true,
  "alwaysOnTier": "executive",
  "alwaysOnServiceName": "ao-emp-daniel",
  "alwaysOnAccessPointId": "fsap-xxxxxx",
  "alwaysOnStatus": "running",
  "imCredentials": {
    "feishu": { "appId": "cli_xxx", "appSecret": "encrypted...", "connectedAt": "2026-04-14T..." },
    "telegram": null
  },
  "imAllowedPlatforms": null
}
```

**POS# record — 新增字段：**

```json
{
  "PK": "ORG#acme",
  "SK": "POS#pos-exec",
  "allowedIMPlatforms": ["feishu", "telegram", "slack"]
}
```

**USAGE# — 区分 agent_type：**

```
USAGE#emp-daniel/serverless#2026-04-14  → Serverless Agent 用量
USAGE#emp-daniel/always-on#2026-04-14   → Always-On Agent 用量
```

### 5.2 EFS Access Points

```
每个 always-on 员工一个：
  AccessPoint: fsap-daniel
    FileSystemId: fs-xxx
    RootDirectory: /emp-daniel
    PosixUser: {Uid: 1000, Gid: 1000}
```

### 5.3 SSM Parameters (仅 endpoint 注册)

```
/openclaw/{stack}/always-on/ao-emp-daniel/endpoint = http://10.0.1.x:8080
/openclaw/{stack}/always-on/ao-emp-daniel/gateway-token = xxx
```

IM 凭证不再存 SSM，改存 DynamoDB EMP#.imCredentials（KMS 加密）。

---

## 6. Infrastructure Changes

### 6.1 CloudFormation — 新增 4 个 Task Role

| Role | Bedrock | S3 | DynamoDB | SSM | 公网出站 |
|------|---------|-----|----------|-----|---------|
| `{stack}-ecs-role-standard` | InvokeModel | read/write | read/write | read | 443 only |
| `{stack}-ecs-role-restricted` | InvokeModel | read only | read only | read | 禁止 |
| `{stack}-ecs-role-engineering` | InvokeModel | full + delete | full + delete | full | 全部 |
| `{stack}-ecs-role-executive` | InvokeModel + List | full | full | full | 全部 |

### 6.2 CloudFormation — 新增 4 个 Security Group

| SG | 入站 | 出站 |
|----|------|------|
| `{stack}-ecs-sg-standard` | 8080 from EC2 SG | 443 (Bedrock/S3/DDB) |
| `{stack}-ecs-sg-restricted` | 8080 from EC2 SG | 443 (Bedrock/S3/DDB only, no internet) |
| `{stack}-ecs-sg-engineering` | 8080 from EC2 SG | All |
| `{stack}-ecs-sg-executive` | 8080 from EC2 SG | All |

### 6.3 EC2 Mount EFS

```bash
# ec2-setup.sh 新增
EFS_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='AlwaysOnEFSId'].OutputValue" --output text)
mkdir -p /mnt/efs
mount -t efs $EFS_ID:/ /mnt/efs
echo "$EFS_ID:/ /mnt/efs efs _netdev,tls 0 0" >> /etc/fstab
```

---

## 7. API Changes

### 7.1 Container APIs (server.py)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/channels/add` | `openclaw channels add` — 添加 IM channel |
| POST | `/admin/channels/remove` | `openclaw channels remove` — 删除 IM channel |
| GET | `/admin/channels/list` | `openclaw channels list --json` — 获取 channel 状态 |
| POST | `/admin/refresh` | 清 workspace 缓存（已实现） |
| POST | `/admin/refresh-all` | 清所有缓存（已实现） |

### 7.2 Admin Console APIs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/api/v1/agents/{emp_id}/always-on` | Admin | 开通/关闭 always-on（创建/停止 ECS Service） |
| GET | `/api/v1/agents/{emp_id}/always-on/status` | Admin | 容器状态（running/stopped/starting） |
| POST | `/api/v1/agents/{emp_id}/always-on/restart` | Admin | 重启容器 |
| GET | `/api/v1/agents/{emp_id}/always-on/channels` | Admin | IM 连接状态 |
| DELETE | `/api/v1/agents/{emp_id}/always-on/channels/{channel}` | Admin | 断开 IM |
| PUT | `/api/v1/security/positions/{pos_id}/im-platforms` | Admin | 设置 IM 白名单 |
| GET | `/api/v1/security/fargate/overview` | Admin | 所有 always-on 容器概览 |

### 7.3 Portal APIs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/portal/my-agents` | Employee | 两个 Agent 状态 |
| POST | `/api/v1/portal/agent/channels/add` | Employee | 自助连 IM（检查白名单） |
| DELETE | `/api/v1/portal/agent/channels/{channel}` | Employee | 自助断开 IM |
| GET | `/api/v1/portal/agent/channels` | Employee | 我的 IM 连接状态 |
| POST | `/api/v1/portal/chat` | Employee | 发消息（带 agent_type 参数） |

### 7.4 Workspace APIs（区分 S3/EFS）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/workspace/{emp_id}/files?agent_type=serverless` | Admin | 读 S3 workspace |
| GET | `/api/v1/workspace/{emp_id}/files?agent_type=always-on` | Admin | 读 EFS workspace |
| GET | `/api/v1/workspace/{emp_id}/download/{path}?agent_type=...` | Admin/Employee | 下载文件（API 代理，不暴露 S3/EFS） |

---

## 8. Cost Model

### Per-Tier Resource Configuration

| Tier | CPU | Memory | 月费 | 理由 |
|------|-----|--------|------|------|
| **Standard** (AE,CSM,HR,PM) | 0.25 vCPU | 512 MB | $7.42 | 日常对话，web_search，轻量任务 |
| **Restricted** (FA,Legal) | 0.25 vCPU | 512 MB | $7.42 | 只读权限，不跑代码，不需要大内存 |
| **Engineering** (SDE,DevOps,QA) | 0.5 vCPU | 1 GB | $16.34 | shell/code_execution，npm install，编译，文件处理 |
| **Executive** (Exec,SA) | 0.5 vCPU | 1 GB | $16.34 | 多工具并行，deep-research，大上下文窗口模型 |

Admin 开通时可以调整（Fargate 支持 0.25-16 vCPU / 512MB-120GB）。
AgentCore microVM 不可调（平台固定分配，无 API），这是 OOM 时无法解决的原因。

### Per-Employee Always-On Cost

| 员工 Tier | Fargate | EFS | Bedrock | 合计（估） |
|----------|---------|-----|---------|----------|
| Standard | $7.42 | ~$0.03 | ~$2-5 | **~$10-13/mo** |
| Restricted | $7.42 | ~$0.03 | ~$1-3 | **~$9-11/mo** |
| Engineering | $16.34 | ~$0.03 | ~$5-15 | **~$22-32/mo** |
| Executive | $16.34 | ~$0.03 | ~$10-30 | **~$27-47/mo** |

### Scale Estimates

| 规模 | Serverless Only | 10% Always-On (混合) | 50% Always-On |
|------|----------------|---------------------|---------------|
| 20 人 | ~$80/mo | +$22 (2人) = ~$102 | +$110 (10人) = ~$190 |
| 100 人 | ~$120/mo | +$110 (10人) = ~$230 | +$550 (50人) = ~$670 |
| 500 人 | ~$200/mo | +$550 (50人) = ~$750 | +$2,750 (250人) = ~$2,950 |

---

## 9. Security

### 9.1 Four-Layer Per-Tier

| Layer | Implementation |
|-------|---------------|
| L1 SOUL | workspace_assembler.py 注入（不变） |
| L2 Plan A | permissions.py 工具白名单（不变） |
| L3 IAM | per-tier Task Role（4 个，权限递进） |
| L4 Network | per-tier Security Group（Restricted 禁公网） |
| L5 Guardrail | GUARDRAIL_ID env var → server.py apply（不变） |

### 9.2 EFS Isolation

- 每个员工一个 EFS Access Point（硬隔离）
- 容器只能访问自己的 `/emp-{id}` 目录
- EC2 mount 根目录（Admin 全局视图）

### 9.3 IM Credential Security

- 凭证存 DynamoDB EMP#.imCredentials（KMS 加密）
- Portal / Admin Console 只显示 masked
- 容器启动时从 DynamoDB 读取 → 写入 openclaw.json → EFS 持久化
- Admin [Disconnect] 时同时删 DynamoDB 凭证 + 容器内 `openclaw channels remove`

---

## 10. Lifecycle

### 10.1 开通 Always-On

```
Admin [Save] → create Access Point → register Task Def → create ECS Service
  → 容器启动 → S3 MEMORY 迁移到 EFS → Gateway 启动 → DynamoDB 读 IM 凭证
  → openclaw channels add → IM 连接建立 → SSM endpoint 注册 → Ready
```

### 10.2 员工转岗

```
Position 变化 → Serverless 自动跟（position-based routing）
  → Always-On: Admin Console 提示 "Position changed, container needs restart"
  → Admin 点 [Restart] → 停旧 Service → 新 tier 的 Role + SG + Model + Guardrail
  → 注册新 Task Def → 启动新 Service → EFS 数据保留（Access Point 不变）
```

### 10.3 员工离职

```
Admin 删员工 → cascade:
  1. 停 ECS Service (desiredCount=0)
  2. 删 ECS Service
  3. 删 EFS Access Point
  4. 删 EFS 目录 (rm -rf /mnt/efs/emp-xxx/)
  5. 删 DynamoDB EMP#.imCredentials
  6. 删 SSM endpoint + gateway-token
  7. 删 S3 serverless workspace
  8. 删 DynamoDB AGENT#, BIND#, SESSION#, CONV#
```

### 10.4 容器 Crash

```
ECS Service desiredCount=1 → 自动重启新 Task
  → EFS 数据完整（Access Point 持久）
  → Gateway 读 EFS 上的 openclaw.json → 自动重连 IM
  → SSM endpoint 重新注册（新 IP）
  → 员工无感知
```

---

## 11. Implementation Order

### Phase 2A: Core Infrastructure (1 session)

```
1. CloudFormation: 4 per-tier Task Roles + 4 per-tier Security Groups
2. EC2 mount EFS (ec2-setup.sh)
3. admin_always_on.py: 重构 start → 创建 Access Point + per-tier Role/SG
4. server.py: /admin/channels/add, /admin/channels/remove, /admin/channels/list
5. entrypoint.sh: 启动时从 DynamoDB 读 IM 凭证 → openclaw channels add
6. DynamoDB: EMP# 新字段 (alwaysOnEnabled, imCredentials, etc.)
7. 端到端测试: 创建一个 always-on agent → 连 Telegram → 收发消息
```

### Phase 2B: Admin Console (1 session)

```
1. Agent Factory: Deploy Mode toggle + IM Management tab
2. Security Center: Fargate overview panel
3. Workspace Explorer: agent_type switcher (S3/EFS)
4. agents.py: always-on CRUD endpoints
5. security.py: IM platform whitelist endpoints
6. 端到端测试: Admin 开通 → 员工连 IM → Admin 断开 → 审计日志
```

### Phase 2C: Portal (1 session)

```
1. Portal "My Agents" page: 两个 Agent 卡片
2. IM Connect flow: 平台选择 → 凭证输入 → 验证
3. Chat switcher: [Serverless] [Always-On]
4. portal.py: channels add/remove/list endpoints
5. 端到端测试: 员工自助连 IM → 对话 → 断开
```

### Phase 2D: Billing & Lifecycle (1 session)

```
1. USAGE# agent_type 区分
2. Usage 页面: Bedrock + Fargate 合计成本
3. Budget: 两个 Agent 共享员工预算
4. 离职 cascade 删除
5. 转岗 restart 提示
```

---

## 12. TODO Checklist

### Phase 2A: Infrastructure

- [ ] CloudFormation: 4 ECS Task Roles (standard/restricted/engineering/executive)
- [ ] CloudFormation: 4 Security Groups (per-tier outbound rules)
- [ ] ec2-setup.sh: mount EFS on EC2
- [ ] admin_always_on.py: create EFS Access Point per employee
- [ ] admin_always_on.py: select per-tier Role + SG when creating Service
- [ ] admin_always_on.py: register per-employee Task Definition with Access Point
- [ ] server.py: POST /admin/channels/add (subprocess openclaw channels add)
- [ ] server.py: POST /admin/channels/remove
- [ ] server.py: GET /admin/channels/list
- [ ] entrypoint.sh: read DynamoDB imCredentials → openclaw channels add on boot
- [ ] entrypoint.sh: first boot → copy S3 MEMORY to EFS (serverless → always-on migration)
- [ ] DynamoDB: EMP# schema update (alwaysOnEnabled, imCredentials, etc.)
- [ ] DynamoDB: POS# schema update (allowedIMPlatforms)
- [ ] Test: create always-on → connect Telegram → send/receive message

### Phase 2B: Admin Console

- [ ] Agent Factory: Deploy Mode toggle UI
- [ ] Agent Factory: IM Management tab (status, disconnect, whitelist)
- [ ] Security Center: Fargate overview panel (all containers, status, cost)
- [ ] Workspace Explorer: agent_type switcher → read S3 or EFS
- [ ] agents.py: PUT/GET/DELETE always-on endpoints
- [ ] security.py: PUT /positions/{id}/im-platforms
- [ ] security.py: GET /fargate/overview
- [ ] Test: Admin full workflow (enable → manage IM → disconnect → disable)

### Phase 2C: Portal

- [ ] My Agents page: two agent cards
- [ ] IM Connect modal: platform select → credential input → verify
- [ ] Chat page: [Serverless] / [Always-On] switcher
- [ ] portal.py: POST /portal/agent/channels/add (with whitelist check)
- [ ] portal.py: DELETE /portal/agent/channels/{channel}
- [ ] portal.py: GET /portal/agent/channels
- [ ] portal.py: GET /portal/my-agents
- [ ] Test: employee self-service IM connect → chat → disconnect

### Phase 2D: Billing & Lifecycle

- [ ] server.py: USAGE# write with agent_type field
- [ ] usage.py: aggregate by agent_type, show Bedrock + Fargate cost
- [ ] Usage page: per-employee two-row display or sub-items
- [ ] org.py: cascade delete (ECS Service + Access Point + EFS + DDB + SSM + S3)
- [ ] agents.py: position change → prompt restart
- [ ] Budget: shared per-employee, sum of both agents
- [ ] Test: verify billing data, cascade delete, position change
