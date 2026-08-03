# design-to-code

Antigravity IDE plugin：把 Figma 设计稿或 UI 截图还原成前端代码的工作约束包。

融合两条信息源——Framelink MCP 取的节点数据（`get_figma_data`，数值精确）与用户截图（结构准确），含反捏造四红线护栏。

## 解决什么问题

| 信息源 | 强项 | 硬伤 | 当前状态 |
|---|---|---|---|
| Framelink `get_figma_data` | 数值精确（颜色/字号/边框/尺寸） | 设计不规范时布局结构错乱 | ✅ 启用 |
| Framelink `download_figma_images` | 下真实 SVG/PNG/GIF 素材替代占位图 | — | ✅ 启用 |
| 视觉模型看用户截图 | 布局结构准 | 无精确像素 | ✅ 用户给 |
| f2c `get_code_to_component` | 一键出代码 + 自动下素材 | 布局常混乱（不看截图、不读 ground-truth），模型偷懒直接用+编造修复汇报 | ❌ 已禁用 |

本 plugin 用 **fusion**（截图定结构、Framelink 数据定数值、模型自己生成代码）解决布局与数值的矛盾。`design-ground-truth.json` 从 Figma 取精确节点样式，**主用途是给模型生成代码时查值**（bg/border/字号/圆角/阴影都从这里取，不靠截图猜），**次用途是校验凭证**（verify 脚本事后反查抓没查 ground-truth 凭空写的值）。ground-truth 只服务反捏造四红线里的第四条（禁凭空数值），其余三条由 `download_figma_images`（禁占位图）、截图逐字复制（禁凭空文案）、design-system registry（禁新造组件）分别承载。另叠加 **两阶段强制确认闸口**（4a 输出结构描述给用户确认、4b 确认后才生成代码）防止模型偷懒直接用 f2c 输出并编造幻觉汇报。解决三个高频痛点：MCP 数据准但布局乱、模型凭空捏造占位图/硬编码文案/臆造组件、模型偷懒直接用 f2c 输出并编造"已按截图修复"的幻觉汇报。

这套做法与 Figma 官方 MCP 指南的建议方向一致（指南推荐"标记完成前与 Figma 1:1 校验"），并落地了 Framelink 的 `get_figma_data` + `download_figma_images` 两个工具。Fusion + ground-truth 回锁 + 两阶段确认闸口是本项目的设计，社区未找到完整对标项目。

## 包含什么

```
design-to-code-plugin/                   plugin 根
├── plugin.json                          manifest（仅 name 字段，Antigravity 官方规范）
├── skills/
│   └── design-to-code/                  完整 skill（自包含）
│       ├── SKILL.md                     主入口：fusion 流程 + 触发条件 + 资源索引
│       ├── references/                  7 份细分规则
│       │   ├── fusion-protocol.md          截图 vs MCP 冲突取舍规则
│       │   ├── anti-fabrication.md         反捏造四红线完整版（正反例）
│       │   ├── ground-truth-lock.md        如何导出 ground-truth.json + 机械校验
│       │   ├── framework-react.md          React + Tailwind / CSS Modules
│       │   ├── framework-vue.md            Vue 3 + <script setup>
│       │   ├── framework-miniapp.md        微信/支付宝小程序
│       │   └── fallback-bitmap-only.md     纯位图无源文件时的兜底
│       ├── scripts/
│       │   └── verify-ground-truth.js      零依赖 Node 校验脚本
│       └── templates/                   其他 IDE 的安装片段（跨工具复用）
│           ├── agents-md-fragment.md       注入 AGENTS.md（ZCode 通用）
│           ├── claude-md-fragment.md       注入 ~/.claude/CLAUDE.md
│           ├── cursor-rule.mdc             .cursor/rules/design-to-code.mdc
│           ├── zcode-command.md            ZCode /figma slash command
│           ├── posttooluse-hook.json       ZCode PostToolUse hook 示例
│           ├── gemini-md-fragment.md       注入 ~/.gemini/GEMINI.md（Antigravity 全局）
│           ├── antigravity-rule.md         Antigravity workspace rule 模板
│           ├── antigravity-hooks.json      Antigravity hooks 配置模板
│           ├── antigravity-hook-script.js  对应 hook 脚本模板
│           ├── antigravity-plugin-structure.md  打 plugin 的结构说明
│           └── ground-truth.schema.json    ground-truth.json 的 JSON Schema
├── rules/
│   └── design-to-code.md                workspace rule（设 Always On）
├── hooks.json                           PreToolUse 自动护栏配置（指向 scripts/dtc-hook.js）
├── scripts/
│   ├── dtc-hook.js                      护栏脚本（占位图 URL + lorem ipsum）
│   └── selfcheck.js                     自检脚本（一键验证 11 项链路）
└── README.md                            本文件
```

## 安装

### 方式 A：Antigravity workspace 级（团队共享）

```bash
# clone 到你 repo 的 .agents/plugins/ 下
git clone https://github.com/Ybqac/design-to-code-plugin.git <your-repo>/.agents/plugins/design-to-code
# 重启 Antigravity，打开该 workspace，IDE 自动扫描加载
```

### 方式 B：Antigravity user 级（个人跨项目）

```bash
git clone https://github.com/Ybqac/design-to-code-plugin.git ~/.gemini/config/plugins/design-to-code
# 重启 Antigravity，所有 workspace 都能用
```

### 方式 C：只想要 skill 不要 plugin

skill 部分可独立使用，复制 `skills/design-to-code/` 到任意 skill 发现目录（`~/.agents/skills/` 或 `~/.gemini/config/skills/`）即可。

## 验证安装

### 一键自检（推荐）

```bash
node <plugin-path>/scripts/selfcheck.js
```

跑完 11 项检查（文件完整性 / Node / Antigravity 环境 / Figma MCP / hook / verify 三态），全绿即整条链路通。有失败项会附修复提示。

### 手动验证（可选，自检不够时用）

```bash
# 1. 验证 hook 护栏：模拟写 picsum URL，应被 ask 拦截
node -e 'const fs=require("fs"); fs.writeFileSync("/tmp/dtc.json", JSON.stringify({toolCall:{name:"write_to_file",args:{TargetFile:"/tmp/Card.tsx",CodeContent:"<img src=\"https://picsum.photos/40\" />"}}}))'
node <plugin-path>/scripts/dtc-hook.js < /tmp/dtc.json
# 期望输出: {"decision":"ask","reason":"...占位图URL..."}
rm -f /tmp/dtc.json

# 2. 验证 verify-ground-truth.js
node <plugin-path>/skills/design-to-code/scripts/verify-ground-truth.js <code-dir> design-ground-truth.json
```

> 注：自检和手动验证只能确认**脚本层和环境配置**正确。Antigravity IDE 运行时是否真的加载 plugin / 接入 hook，需重启 IDE 后实写一次含 picsum URL 的代码看是否弹 ask 确认。

## Figma MCP

**不在 plugin 内配**。MCP server 配置含 accessToken 是 secret，不该进版本控制；不同用户/团队用各自的 Figma MCP server。团队成员各自在 `~/.gemini/config/mcp_config.json` 配自己的 server，参考模板（**不含真实 token**）：

```json
{
  "mcpServers": {
    "<your-figma-mcp-name>": {
      "command": "npx",
      "args": ["-y", "<your-figma-mcp-package>", "--mcpServer=<your-server-url>", "--accessToken=<your-token>"]
    }
  }
}
```

## 与项目既有约束的协同

本 plugin 设计为**只补 ESLint 抓不到的**，不与项目 lint 重复：

| 维度 | 项目既有（如 ESLint design-tokens） | 本 plugin |
|---|---|---|
| 硬编码颜色/字号/z-index | 交项目 ESLint | 不重复 |
| 占位图 URL / picsum | 通常无 | PreToolUse hook 硬拦 ✓ + `download_figma_images` 下真图替代 |
| lorem ipsum | 通常无 | PreToolUse hook 硬拦 ✓ |
| 凭空造组件 | 通常无 | rule 约束 registry |
| ground-truth 出处核对 | 通常无 | verify-ground-truth.js |

若项目无 ESLint design-tokens 规则，可在 `scripts/dtc-hook.js` 的 `scan()` 里追加颜色/字号正则。

## 反捏造四红线（速记）

- 禁占位图 URL（placeholder/picsum/unsplash 等）——正解是调 Framelink `download_figma_images` 下真实素材
- 禁凭空文案（只复制截图可见的逐字内容）
- 禁新造 design-system 之外的同名组件
- 禁凭空精确数值（每值在 ground-truth.json 有出处或显式标"截图估读"）
- **禁直接用 f2c 输出当最终代码**（f2c 草稿必须经过 fusion 重写——读截图→重写布局→对齐 ground-truth）

## 设计依据

- **Framelink**（`figma-developer-mcp` v0.13.2）：实际暴露 2 个工具——`get_figma_data`（取节点树 layout/styling/content/component，作为 ground-truth 数值来源）和 `download_figma_images`（下真实素材，根治占位图）。**注意：v0.13.2 不含 `get_node_screenshot`**——截图需由用户提供
- **Figma 官方 MCP 指南**："标记完成前与 Figma 1:1 校验"是官方文档的推荐做法，不是强制要求
- **Framelink issue tracker 同类问题证据**：#232（flex 交叉轴方向反）、#390（填色层叠顺序错）、#368（跨文件图片合并→模型瞎编占位）
- **多模态大模型特性**：UI 截图理解强在整体语义、弱在密集小目标与精确像素——故精确数值交 MCP `get_figma_data`、结构交用户截图视觉融合
- **融合机制**：把 MCP 精确数值与截图视觉判断显式融合成统一信号源，是本 plugin 的设计选择，社区未找到完整对标项目
