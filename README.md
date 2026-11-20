<div align="center">

# design-to-code (dtc)

**Figma → 高保真前端代码的本地闭环工具链**

确定性提取 · AI 生成 · 像素级验证回归 · 反捏造校验

[安装](#-安装) · [最小用法](#-最小用法) · [工作流](#-工作流) · [配置](#️-配置) · [排错](#-排错)

`MIT` `Node ≥ 20` `全程本地 · 无遥测`

</div>

---

## 📥 安装

Node ≥ 20。目标项目零安装。

```bash
git clone https://github.com/Ybqac/design-to-code.git ~/code/design-to-code-plugin
cd ~/code/design-to-code-plugin
npm install && npm run build && npm run dtc -- setup
```

`dtc setup` 六步，各做一件事：

1. 构建自检：缺 `packages/mcp/dist/server.js` 才执行 `npm install && npm run build`。
2. `npm link` 注册全局 `dtc`。失败会打印 link 目标前缀，不假装已在 PATH。新开终端后用 `dtc`；当前终端用 `npm run dtc --`。
3. `dtc relay start`。3055 已有监听则复用，日志 `~/.dtc/relay.log`。
4. 写入 `~/.cursor/mcp.json`（`node` + server.js 绝对路径，保留其他 server）、`~/.cursor/rules/` 两条规则、`~/.agents/skills/design-to-code/SKILL.md`。规则和 skill 整文件覆盖。
5. Figma 通道。未连接时打印安装指引。
6. 检查 Playwright chromium，没有就 `npx playwright install chromium`。

结束时跑 `dtc doctor`。重启 Cursor。

通道只主推这一条：Figma 桌面 App → Plugins → Development → Import plugin from manifest → `plugin/build/desktop/manifest.json`。

次级（`dtc plugin install` 与 `dtc setup` 同一份列表）：

- 扩展：解压 `plugin/build/dtc-bridge-chrome-extension.zip` → chrome://extensions 开「开发者模式」→ 拖入 chrome-extension 文件夹
- 用户脚本：Tampermonkey 拖入 `plugin/build/web/dtc-bridge.user.js`
- 书签：打开 `plugin/build/web/dtc-bridge.bookmarklet.html`，把按钮拖到书签栏

装好后打开设计文件，面板右上角显示已连接（channel `dtc`）。

<details>
<summary><b>setup 等价于什么</b></summary>

上面六步，加上结束时的 `dtc doctor`。`--yes` 不等待插件连接（CI / 非 TTY 同样跳过等待）。

斜杠命令不在默认安装里：`npm run dtc -- setup --project <项目目录>` 只拷 `integrations/cursor/commands/*.md`，不写项目级 rules，不写项目级 mcp。

`bash integrations/cursor/install.sh` 只是转调 `dtc setup`（`--global` 与默认相同，位置参数转成 `--project`）。

</details>

## 💬 最小用法

在任意项目对话框说：把我在 Figma 里选中的节点还原成代码。

对话里只报 4 行：选中节点、一两句结构概览、`溯源校验：N 色 M 尺寸全过 0 伪造`、请确认。`.dtc/` 是工具产物，不要手改。

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

在 Cursor 里：你说一句话 → agent 调 `dtc_sel` 确认选区 → `dtc_extract` 提取 → **对话里只报 4 行摘要** → 你确认 → 生成 → verify 循环 → check → 交付报告。

### 命令参考

| 命令 | 说明 |
|---|---|
| `dtc setup` | 全局安装六步，结束时 doctor。`--yes` 全自动（CI）。`--project <dir>` 只额外拷斜杠命令 |
| `dtc relay <start\|stop\|status>` | 内置 relay。3055 已占用则复用；日志 `~/.dtc/relay.log` |
| `dtc extract` | 提取规格包 → `.dtc/`。`--node <id>` 或 `--selection`（当前选区）；`--from-rest --file-key --pat`（REST 备用）；`--from-snapshot`（离线）；`--viewport`、`--ref-scale`、`--max-assets` |
| `dtc sel` | 查看当前 Figma 选区（附现成提取命令） |
| `dtc verify --url <url>` | 视觉回归闭环。退出码 `0` 收敛 / `1` 继续修复 / `2` 停滞需人工；产物 `report-N.json` + `diff.png` + `fix-prompt.md` |
| `dtc check <dir>` | 反捏造：ground-truth 溯源 + 硬编码值反查 + 占位图红线 |
| `dtc plugin <build\|install>` | 通道四形态打包 / 安装指引（主推桌面 manifest） |
| `dtc doctor` | 环境自检：安装落盘 + Node + relay/插件 + chromium + .dtc |

MCP server（stdio，7 工具）：`packages/mcp/dist/server.js`，由 setup 写进 `~/.cursor/mcp.json`。

## ⚙️ 配置

| 项 | 作用 |
|---|---|
| `~/.cursor/mcp.json` | setup 合并写入 `mcpServers.dtc`：`command` 为 `node`，`args` 为 server.js 绝对路径。不删其他 server，不写 PAT |
| `~/.cursor/rules/dtc-workflow.mdc` | 全局工作流（含技术栈 6 条）。安装器覆盖，不合并手工编辑 |
| `~/.cursor/rules/dtc-anti-fabrication.mdc` | 反捏造四红线。同样整文件覆盖 |
| `~/.agents/skills/design-to-code/SKILL.md` | setup 生成的 skill，步骤与规则同一顺序 |
| `~/.dtc/relay.log` | relay 日志 |
| `DTC_RELAY_PORT` | relay 进程监听端口，默认 3055。CLI 探测与提取默认连 3055 |
| `--pat` | 只作为 `dtc extract --from-rest --file-key <key> --pat <token>` 的参数。代码不读 PAT 环境变量 |

示例 mcp 条目见 `integrations/cursor/mcp.json`（占位说明，不是安装模板）。

### .dtc/ 目录

| 文件 | 内容 |
|---|---|
| `manifest.json` | 提取元信息 |
| `raw-node-snapshot.json` | 原始节点树（溯源基准，勿改） |
| `design-ground-truth.json` | 数值锁（生成的数值依据） |
| `spec.json` / `structure.yaml` | AI 消费规格 / 4 行闸口的结构确认文件 |
| `ref/frame.png` · `assets/` | 参考图 · 素材切图 |
| `verify/` | report-N.json、diff.png、impl.png、fix-prompt.md |

不想入库就在项目 `.gitignore` 加一行 `.dtc/`。没提取过是预期状态，安装成功不要求它存在。

Cursor 全局接入就是 `dtc setup`（`bash integrations/cursor/install.sh` 等价，`--global` 写入同一个 `~/.cursor/mcp.json`）。

## 🩺 排错

`dtc doctor` 按这个顺序报。每一项一条命令：

| 现象 | 命令 |
|---|---|
| `~/.cursor/mcp.json` 无法解析，或 `mcpServers.dtc.args` 的 server.js 不存在 | `npm run dtc -- setup` |
| 缺少 `dtc-workflow.mdc` 或 `dtc-anti-fabrication.mdc` | `npm run dtc -- setup` |
| PATH 里没有 `dtc`（警告，不因此判失败） | 在仓库 `packages/cli` 执行 `npm link`；当前终端用 `npm run dtc --` |
| Node &lt; 20 | 安装 Node ≥ 20 |
| relay(3055) 未启动 | `dtc relay start` |
| 插件未连 channel | `dtc plugin install`（主推桌面 App Import manifest） |
| Playwright chromium 缺失 | `npx playwright install chromium` |
| `.dtc/` 尚未提取 | 预期。需要时 `dtc extract`，安装不要求它 |

## 其他宿主

- Claude Code：[`integrations/claude-code/SKILL.md`](integrations/claude-code/SKILL.md)
- 任意 agent：[`integrations/generic/AGENTS.md`](integrations/generic/AGENTS.md)
- 项目斜杠命令（可选）：`dtc setup --project <dir>`，只拷 [`integrations/cursor/commands/`](integrations/cursor/commands/)

## ✨ 特性

- **确定性提取** — 节点树（含 auto-layout、阴影、描边、矢量存根）、设计令牌、参考图、素材切图，ground-truth 数值锁 100% 脚本生成
- **视觉回归闭环** — Playwright 截图 → pixelmatch → 差异热区 → **nodeId 归因**（每个热区对应 Figma 节点，附期望值 vs 实际渲染值）→ fix-prompt 修正循环直到收敛
- **Fidelity Score + 收敛协议** — 像素/结构加权评分（默认 ≥95 收敛，连续 3 轮无改进判停滞），退出码可作 CI 门禁
- **反捏造四红线机械化** — 占位图检测、硬编码数值溯源（每个值须有节点树出处）、4a 结构 YAML 溯源闸口
- **宿主无关** — Cursor（全局一条命令）/ Claude Code / 任意 agent；MCP server 7 工具 + CLI 双形态
- **常驻面板** — Figma 页内诊断面板：连接状态、当前选中节点、命令日志流；channel 固定、断线无限重连

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
npm test        # 单元测试 + 端到端测试
```

## 致谢与许可

MIT。Figma 插件基于 [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp)（MIT）修改；像素对比 [pixelmatch](https://github.com/mapbox/pixelmatch)；渲染截图 [Playwright](https://playwright.dev)。
