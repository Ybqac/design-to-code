# design-to-code (dtc)

Figma → 前端代码还原工具链，由 CLI、MCP server 与 Figma 插件组成。工作方式：从 Figma 提取设计数据（节点树、设计令牌、参考图、切图素材），配合 AI 生成代码，再用像素 diff 与 DOM 结构校验自动测量还原度并定位差异，循环修正直到收敛。

## 功能

- **确定性提取**（`dtc extract`）：经本地 WebSocket 通道获取完整节点树（含 auto-layout、阴影、描边、透明度、矢量存根）、去重设计令牌、参考图、IMAGE/VECTOR 素材切图，自动生成 ground-truth 数值锁与 spec。
- **视觉回归闭环**（`dtc verify`）：Playwright 截图 → pixelmatch 像素对比 → 差异热区聚类 → nodeId 归因（每个热区对应 Figma 节点，附 ground-truth 期望值与 DOM 实际值）→ fix-prompt.md 修正指令；文本类差异走字号/颜色结构校验。
- **Fidelity Score 与收敛协议**：加权评分（像素 70% + 结构 30%），达到阈值（默认 95）收敛；连续多轮无改进判停滞并输出剩余差异报告。退出码可作 CI 门禁。
- **反捏造校验**（`dtc check`）：ground-truth 溯源（每个值须有原始节点树出处）+ 生成代码硬编码值反查 + 占位图 URL 检测。
- **多宿主接入**：Cursor（commands + rules + MCP 一键导入）、Claude Code（skill）、任意 agent（AGENTS.md 片段）。
- **全程本地**：数据经 localhost WebSocket 传输，diff 与报告在本机生成，无遥测。

## 工作流

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

## 环境要求

- Node.js ≥ 20
- Bun（运行 relay）
- Figma（桌面 App 或浏览器版）
- 本仓库 `~/code/design-to-code-plugin` 与 relay 仓库 `~/code/cursor-talk-to-figma-mcp`

## 安装

### 1. 构建工具链

```bash
cd ~/code/design-to-code-plugin
npm install && npm run build
npx playwright install chromium
alias dtc="node ~/code/design-to-code-plugin/packages/cli/dist/bin.js"
```

### 2. 启动 relay（常驻，保持运行）

```bash
cd ~/code/cursor-talk-to-figma-mcp && bun socket   # 监听 ws://localhost:3055
```

### 3. 安装 Figma 通道插件（一次安装，长期使用）

```bash
dtc plugin install
```

四种形态任选：

| 形态 | 文件 | 安装方式 |
|---|---|---|
| Chromium 扩展 | `plugin/build/dtc-bridge-chrome-extension.zip` | 解压 zip 得到 `chrome-extension` 文件夹 → 打开 `chrome://extensions` → 开启「开发者模式」→ 将文件夹拖入扩展页（或点「加载已解压的扩展程序」选择该文件夹）。无需安装其他扩展管理器，也不需要"打包扩展程序"（.crx 面向商店分发，本地安装会被 Chrome 拦截） |
| 桌面 App 插件 | `plugin/build/desktop/manifest.json` | Figma 桌面 App → Plugins → Development → Import plugin from manifest |
| 浏览器用户脚本 | `plugin/build/web/dtc-bridge.user.js` | 安装 Tampermonkey 扩展后，将文件拖入浏览器窗口 |
| 书签 | `plugin/build/web/dtc-bridge.bookmarklet.html` | 浏览器打开该页，将「▶ dtc bridge」拖到书签栏（每次刷新后需重新点击） |

装好后打开 Figma 文件，连接插件（channel 默认 `dtc`，与 CLI 参数一致；用户脚本版右上角角标可切换 channel）。

### 4. 环境自检

```bash
dtc doctor   # relay、Figma 插件、Playwright chromium、.dtc 规格包逐项检查
```

## 使用

### 完整流程

1. **提取**：`dtc extract --node 14669-9900`（nodeId 取自 Figma 链接的 `?node-id=` 参数）。产物写入项目下 `.dtc/`。
2. **结构确认（人工闸口）**：读 `.dtc/spec.json` 与参考图，输出结构描述（层级 + 布局模型 + 关键数值）供确认。展示前可跑 YAML 溯源校验：
   ```bash
   node skills/design-to-code/scripts/verify-yaml-provenance.js <fusion-layout-spec.yaml> .dtc/raw-node-snapshot.json
   ```
3. **生成代码**：由 AI 按 `.dtc/` 数值与素材生成，跟随目标项目技术栈；颜色/字号/圆角/间距取自 ground-truth 并注释 nodeId，素材引用 `.dtc/assets/`。
4. **验证环**：
   ```bash
   dtc verify --url http://localhost:5173
   ```
   按 `.dtc/verify/fix-prompt.md` 修复后重跑，循环直到收敛（exit 0）或停滞（exit 2）。
5. **反捏造校验**：`dtc check src/`。
6. **交付报告**：文件清单、Fidelity Score 与轮次、check 结果、剩余差异。

### 命令参考

| 命令 | 说明 | 常用参数 |
|---|---|---|
| `dtc extract` | 提取规格包 → `.dtc/` | `--node <id>`（必填）；`--channel`（默认 dtc）；`--out`（默认 .dtc）；`--viewport WxH`；`--ref-scale`（默认 2）；`--from-rest --file-key <k> --pat <token>`（REST 备用通道）；`--from-snapshot <json>`（离线重放）；`--max-assets` |
| `dtc verify` | 视觉回归闭环 | `--url`（必填，http(s)/file/本地 html 路径）；`--viewport`；`--full-page`；`--round`；`--pixel-threshold`（默认 0.1）；`--score-threshold`（默认 95）；`--max-stalled`（默认 3）；`--max-rounds`（默认 10）；`--wait-ms` |
| `dtc check` | 反捏造校验 | `<code-dir>`（必填）；`--skip-provenance`；`--skip-scan` |
| `dtc plugin` | 通道插件打包/安装指引 | `build` / `install`；`--src`；`--dist` |
| `dtc doctor` | 环境自检 | `--channel`；`--out` |

**`dtc verify` 退出码**：`0` 已收敛；`1` 未达标，按 fix-prompt 修复后重跑；`2` 停滞或达轮次上限，输出剩余差异清单。

**MCP server**：`packages/mcp/dist/server.js`（stdio），tools：`dtc_doctor` / `dtc_extract` / `dtc_verify` / `dtc_read_report` / `dtc_fix_prompt` / `dtc_check`。

## 宿主接入

### Cursor

```bash
bash integrations/cursor/install.sh <你的项目目录>
```

生成：`.cursor/commands/design-to-code.md` 与 `dtc-verify.md`（斜杠命令）、`.cursor/rules/*.mdc`（工作流/反捏造/技术栈自适应规则）、`.cursor/mcp.json` 中注册 dtc server。之后在 Cursor 中输入 `/design-to-code <Figma链接>` 执行完整流程，或 `/dtc-verify <URL>` 单跑验证环。

### 其他宿主

- Claude Code：`integrations/claude-code/SKILL.md`
- 任意 agent：`integrations/generic/AGENTS.md`（指令片段，可贴入 AGENTS.md / 系统提示）
- ZCode 等支持 skills 的宿主：`skills/design-to-code/`

## .dtc/ 目录

| 文件 | 内容 |
|---|---|
| `manifest.json` | 提取元信息（nodeId、视口、通道能力、素材清单） |
| `raw-node-snapshot.json` | 原始节点树返回（溯源基准，勿改） |
| `unified-tree.json` | 归一化节点树（验证环归因用） |
| `design-ground-truth.json` | 数值锁 v3（生成代码时的数值依据） |
| `spec.json` | AI 消费用规格（结构 + 样式 + 布局提示） |
| `ref/frame.png` | 参考图 |
| `assets/` | 素材切图（PNG/SVG） |
| `verify/` | report-N.json、diff.png、impl.png、fix-prompt.md |

`.dtc/` 为工具产物，如不想入库可在项目 `.gitignore` 中加一行 `.dtc/`。

## 仓库结构

```
packages/core   核心库：节点树归一化 / ground-truth 生成 / spec / 布局推断 /
                diff 聚类 / nodeId 归因 / 评分与收敛 / fix-prompt
packages/cli    dtc 命令行（extract/verify/check/plugin/doctor）+ relay WebSocket 客户端
packages/mcp    stdio MCP server
plugin/src      Figma 插件源码（fork of grab/cursor-talk-to-figma-mcp，富字段版）；
                plugin/build/ 由 dtc plugin build 产出四形态（desktop / chrome 扩展 zip / user.js / 书签）
integrations/   cursor / claude-code / generic 宿主接入物料
skills/         方法论：fusion 仲裁规则、反捏造红线、ground-truth 机制、4a YAML 溯源、目标栈细则
e2e/            端到端测试
docs/           附录（console-injection 应急版）
```

## 开发

```bash
npm run build     # 三包构建 + 类型检查
npm test          # 单元测试 + 端到端测试
```

## 许可与致谢

MIT。Figma 插件基于 [grab/cursor-talk-to-figma-mcp](https://github.com/grab/cursor-talk-to-figma-mcp)（MIT）修改；像素对比使用 [pixelmatch](https://github.com/mapbox/pixelmatch)，渲染截图使用 [Playwright](https://playwright.dev)。
