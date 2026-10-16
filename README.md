<div align="center">

# design-to-code (dtc)

**Figma → 高保真前端代码的本地闭环工具链**

确定性提取 · AI 生成 · 像素级验证回归 · 反捏造校验

[快速开始](#-快速开始) · [工作流](#-工作流) · [命令](#-命令参考)

`MIT` `Node ≥ 20` `全程本地 · 无遥测`

</div>

---

## ✨ 特性

- **确定性提取** — 节点树（含 auto-layout、阴影、描边、矢量存根）、设计令牌、参考图、素材切图，ground-truth 数值锁 100% 脚本生成
- **视觉回归闭环** — Playwright 截图 → pixelmatch → 差异热区 → **nodeId 归因**（每个热区对应 Figma 节点，附期望值 vs 实际渲染值）→ fix-prompt 修正循环直到收敛
- **Fidelity Score + 收敛协议** — 像素/结构加权评分（默认 ≥95 收敛，连续 3 轮无改进判停滞），退出码可作 CI 门禁
- **反捏造四红线机械化** — 占位图检测、硬编码数值溯源（每个值须有节点树出处）、4a 结构 YAML 溯源闸口
- **宿主无关** — Cursor（全局一条命令）/ Claude Code / 任意 agent；MCP server 7 工具 + CLI 双形态
- **常驻面板** — Figma 页内诊断面板：连接状态、当前选中节点、命令日志流；channel 固定、断线无限重连

## 🚀 快速开始

```bash
git clone https://github.com/Ybqac/design-to-code.git ~/code/design-to-code-plugin
cd ~/code/design-to-code-plugin
npm install && npm run build && dtc setup
```

`dtc setup` 自动完成：relay 后台拉起 → Cursor 全局接入（MCP + `~/.cursor/rules/` 规则文件）→ Figma 通道引导 → doctor 自检。重启 Cursor 后，在任意项目对话框直接说：

> 把我在 Figma 里选中的节点还原成代码

<details>
<summary><b>分步安装（等价）</b></summary>

```bash
npm install && npm run build
npx playwright install chromium
cd packages/cli && npm link && cd ../..   # dtc 全局命令
dtc relay start                            # 内置 relay（3055 已有 bun socket 时自动复用）
dtc plugin install                         # Figma 通道（三选一，装一次长期用）
dtc doctor                                 # 全绿即就绪
```

**Figma 通道三种形态**：

| 形态 | 安装方式 |
|---|---|
| Chromium 扩展（推荐） | 解压 `plugin/build/dtc-bridge-chrome-extension.zip` → `chrome://extensions` 开「开发者模式」→ 拖入 `chrome-extension` 文件夹 |
| Figma 桌面 App 插件 | Plugins → Development → Import plugin from manifest → 选 `plugin/build/desktop/manifest.json` |
| 书签 | 打开 `plugin/build/web/dtc-bridge.bookmarklet.html`，把按钮拖到书签栏 |

装好后打开 Figma 设计文件，面板右上角显示 `dtc · dtc`（绿色已连接）即成。

</details>

## 🔁 工作流

```
dtc doctor ──► dtc extract ──► 【人工闸口】结构确认 ──► 生成代码（AI，跟随项目技术栈）
                 │                                          │
                 ▼                                          ▼
             .dtc/ 规格包 ◄──────────────────── dtc verify 闭环（diff→归因→fix-prompt→修复→重跑）
  spec / ground-truth / ref图 / assets        exit=0 收敛 │ exit=2 停滞报告
                                                      │
                                                      ▼
                                              dtc check（反捏造校验）──► 交付报告
```

在 Cursor 里的实际体验：你说一句话 → agent 调 `dtc_sel` 确认选区 → `dtc_extract` 提取 → **对话里只报 4 行摘要**（选中节点 / 结构概览 / `溯源校验：N 色 M 尺寸全过 0 伪造` / 请确认）→ 你确认 → 生成 → verify 循环 → check → 交付报告。

## 📖 命令参考

| 命令 | 说明 |
|---|---|
| `dtc setup` | 一键接入：构建 → 全局命令 → relay → Cursor 全局 → Figma 通道引导 → chromium → doctor。`--yes` 全自动（CI） |
| `dtc relay <start\|stop\|status>` | 内置 relay 守护进程（协议兼容 grab bun socket，自动复用；日志 `~/.dtc/relay.log`） |
| `dtc extract` | 提取规格包 → `.dtc/`。`--node <id>` 或 `--selection`（当前选区）；`--from-rest --file-key --pat`（REST 备用）；`--from-snapshot`（离线）；`--viewport`、`--ref-scale`、`--max-assets` |
| `dtc sel` | 查看当前 Figma 选区（附现成提取命令） |
| `dtc verify --url <url>` | 视觉回归闭环。退出码 `0` 收敛 / `1` 继续修复 / `2` 停滞需人工；产物 `report-N.json` + `diff.png` + `fix-prompt.md` |
| `dtc check <dir>` | 反捏造：ground-truth 溯源 + 硬编码值反查 + 占位图红线 |
| `dtc plugin <build\|install>` | 通道插件打包/安装指引 |
| `dtc doctor` | 环境自检 |

MCP server（stdio，7 工具）：`packages/mcp/dist/server.js`。

## 🔌 宿主接入

| 方式 | 命令 | 得到 |
|---|---|---|
| Cursor 全局（推荐） | `dtc setup`（或 `bash integrations/cursor/install.sh --global`） | 所有项目：MCP 工具 + 全局规则文件 `~/.cursor/rules/`，对话直说 |
| Cursor 项目级 | `bash integrations/cursor/install.sh <项目>` | 斜杠命令 `/design-to-code` + 项目 rules |
| Claude Code | `integrations/claude-code/SKILL.md` | skill |
| 任意 agent | `integrations/generic/AGENTS.md` | 指令片段 |

## 📁 .dtc/ 目录

| 文件 | 内容 |
|---|---|
| `manifest.json` | 提取元信息 |
| `raw-node-snapshot.json` | 原始节点树（溯源基准，勿改） |
| `design-ground-truth.json` | 数值锁（生成的数值依据） |
| `spec.json` / `structure.yaml` | AI 消费规格 / 4a 结构确认文件 |
| `ref/frame.png` · `assets/` | 参考图 · 素材切图 |
| `verify/` | report-N.json、diff.png、impl.png、fix-prompt.md |

不想入库就在项目 `.gitignore` 加一行 `.dtc/`。


## 📦 仓库结构

```
packages/core   核心库：归一化 / ground-truth / spec / 布局推断 / diff 聚类 / nodeId 归因 / 评分收敛
packages/cli    CLI（setup/relay/extract/sel/verify/check/plugin/doctor）+ relay + ws 客户端
packages/mcp    stdio MCP server
plugin/src      Figma 插件源码（fork of grab/cursor-talk-to-figma-mcp）；build 产四形态
integrations/   cursor / claude-code / generic 宿主物料
skills/         方法论：fusion 协议、反捏造、4a YAML 溯源、目标栈细则
e2e/            端到端测试
```

## 🛠️ 开发

```bash
npm run build   # 三包构建 + 类型检查
npm test        # 单元测试 + 端到端测试（23 项）
```

## 致谢与许可

MIT。Figma 插件基于 [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp)（MIT）修改；像素对比 [pixelmatch](https://github.com/mapbox/pixelmatch)；渲染截图 [Playwright](https://playwright.dev)。
