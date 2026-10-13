# design-to-code (dtc)

**高保真 Figma → 代码闭环工作流**：确定性提取 + AI 推断 + 视觉回归闭环。宿主无关（Cursor 优先，兼容 ZCode / Claude Code / 任意 agent），全程本地、零外部 LLM 上传。

从 v1 的"提示词/规则包"（实测保真度 70%，复杂布局 40%）升级为**带执行引擎的工具链**：

- ground-truth 数值锁由脚本 100% 自动生成（v1 靠模型手整，是最大失真源）
- 验证环机械化：Playwright 截图 → pixelmatch diff → 热区聚类 → **nodeId 归因**（哪个区域错、对应哪个 Figma 节点、期望值 vs 实际渲染值）→ fix-prompt 驱动修正循环，直到 Fidelity Score 收敛
- Figma 通道一次安装长期用（桌面 App 插件 / 浏览器用户脚本 / 书签），channel 固定、断线自动重连，告别每次 console 粘贴

## 工作流

```
dtc doctor ──► dtc extract ──► 【人工闸口】结构确认 ──► 生成代码（AI，跟随项目技术栈）
                 │                                          │
                 ▼                                          ▼
             .dtc/ 规格包 ◄──────────────────── dtc verify 闭环（diff→归因→fix-prompt→修复→重跑）
   spec / ground-truth / ref图 / assets        exit=0 收敛 │ exit=2 停滞报告
                                                      │
                                                      ▼
                                              dtc check（反捏造：溯源+占位图红线）──► 交付报告
```

## 快速开始

```bash
# 1. 安装与构建（Node ≥ 20）
cd ~/code/design-to-code-plugin
npm install && npm run build
npx playwright install chromium
alias dtc="node ~/code/design-to-code-plugin/packages/cli/dist/bin.js"

# 2. relay 常驻（复用 grab 的 TalkToFigma relay）
cd ~/code/cursor-talk-to-figma-mcp && bun socket    # ws://localhost:3055

# 3. Figma 通道（一次安装，长期用）
dtc plugin install
#   浏览器首选：把 plugin/build/web/dtc-bridge.user.js 拖入浏览器（Tampermonkey）
#   最稳兜底：Figma 桌面 App → Plugins → Development → Import from manifest
#             → 选 plugin/build/desktop/manifest.json
#   插件里 Connect（channel 默认 dtc）

# 4. 验证环境
dtc doctor        # relay ✅ + 插件 ✅ + chromium ✅

# 5. 提取 → 还原闭环
dtc extract --node 14669-9900            # 从 Figma 链接取 nodeId；产物在 .dtc/
# （AI 按宿主工作流确认结构后生成代码）
dtc verify --url http://localhost:5173   # 循环直到收敛
dtc check src/
```

### Cursor 一键导入

```bash
bash integrations/cursor/install.sh <你的项目目录>
# 生成：.cursor/commands/{design-to-code,dtc-verify}.md + rules/*.mdc + mcp.json(dtc server)
# 之后在 Cursor 里：/design-to-code <Figma链接>
```

其他宿主：`integrations/claude-code/SKILL.md`（Claude Code skills）、`integrations/generic/AGENTS.md`（任意 agent 指令片段）。

## 命令

| 命令 | 作用 |
|---|---|
| `dtc extract --node <id>` | 确定性提取：节点树（富字段）+ 参考图 + 真实素材 + 自动生成 ground-truth/spec → `.dtc/`。备用 `--from-rest --file-key --pat`；兜底 `--from-snapshot <json>` |
| `dtc verify --url <url>` | 视觉回归闭环：截图→pixelmatch→热区→nodeId 归因→`report-N.json`+`diff.png`+`fix-prompt.md`。退出码 `0` 收敛 / `1` 继续修复 / `2` 停滞需人工 |
| `dtc check <dir>` | 反捏造：ground-truth 溯源（每个值须有原始节点树出处）+ 代码硬编码值反查 + 占位图红线 |
| `dtc plugin build\|install` | 通道打包三形态 + 安装指引 |
| `dtc doctor` | 环境自检 |

MCP server（stdio，6 个 tools）：`packages/mcp/dist/server.js`，配置见 `integrations/cursor/mcp.json`。

## 为什么保真度能上去（相对 v1 与通用 F2C 方案）

1. **auto-layout 富字段**：上游插件的字段白名单丢掉了 auto-layout/effects/strokeWeight/VECTOR——这是复杂布局 40% 保真度的根因之一。本仓库的 fork 插件（`plugin/src`）补齐了白名单并解除导图 PNG 硬编码（支持 SVG）。
2. **diff → nodeId 归因**：pixelmatch 只说"哪里不同"；我们把每个热区映射回 Figma 节点，从 ground-truth 取期望值、DOM 探针取实际值，fix-prompt 直接对号入座（开源社区目前没有等价实现）。
3. **结构 + 像素双通道**：文本类细微差异（字号/颜色）走 DOM 值结构校验，规避字体渲染像素底噪。
4. **收敛协议**：score ≥ 阈值（默认 95）收敛；连续 3 轮无改进判停滞，如实输出剩余差异，不许模型谎报完成。
5. **反捏造四红线机械化**：禁占位图 / 禁编文案 / 禁造组件 / 禁凭空数值——红线 1、4 由 `dtc check` 强制，溯源校验防"反向补录"。

## 仓库结构

```
packages/core   纯函数库：normalize（双源归一化）/ ground-truth / spec / layout-infer /
                diff-cluster / attribute（归因）/ score / fix-prompt —— 单测 20 项
packages/cli    dtc 命令 + TalkToFigma relay ws 客户端（协议逆向自 socket.ts）
packages/mcp    stdio MCP server（doctor/extract/verify/read_report/fix_prompt/check）
plugin/src      增强版 Figma 插件源码（单源）；plugin/build 三形态由 dtc plugin build 产出
integrations/   cursor / claude-code / generic 宿主物料
skills/         方法论层（fusion 协议、反捏造、ground-truth 机制、目标栈细则）
e2e/            合成端到端（extract→缺陷验证→收敛→check 全链路断言）
docs/           附录（console-injection 应急版）
```

## 隐私

全程本地：节点数据经 localhost WebSocket，diff 与报告在本机生成，不向任何外部服务发送设计数据（上游插件的 GA 统计已在 fork 中移除）。

## 致谢

- [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp)（MIT）— relay 与插件基础，本仓库的富字段插件是其 fork
- 思路借鉴（未引入依赖）：uimatch 的 Fidelity Score、figma-pixel-kit 的 fix-prompt、Mimikyu 的文本结构校验、imugi 的收敛协议、plumb-mcp 的双通道提取
