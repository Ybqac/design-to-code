# Antigravity Plugin 打包结构（可选，团队分发用）

把 design-to-code 打成 Antigravity plugin，团队 clone repo 后一键启用 skill + rule + hook + MCP 五件套。

## 目录结构

复制到 `<repo>/.agents/plugins/design-to-code/`：

```
.agents/plugins/design-to-code/
├── plugin.json                  # 仅 name 字段必填
├── skills/
│   └── design-to-code/          # 复制 ~/.agents/skills/design-to-code/ 全部内容
│       ├── SKILL.md
│       ├── references/
│       │   ├── fusion-protocol.md
│       │   ├── anti-fabrication.md
│       │   ├── ground-truth-lock.md
│       │   ├── framework-react.md
│       │   ├── framework-vue.md
│       │   ├── framework-miniapp.md
│       │   └── fallback-bitmap-only.md
│       └── scripts/
│           └── verify-ground-truth.js
├── rules/
│   └── design-to-code.md        # workspace rule（plugin 自带，设 Always On）
├── hooks.json                   # 复制 templates/antigravity-hooks.json（去掉 _ 注释字段）
└── scripts/
    └── dtc-hook.js              # 复制 templates/antigravity-hook-script.js
```

## plugin.json 内容

```json
{
  "name": "design-to-code"
}
```

仅 `name` 字段必填（Antigravity plugin 规范）。name 要匹配目录名。

## mcp_config 处理

**不要**把 Figma MCP 配置放进 plugin。原因：
- MCP server 配置含 accessToken，是 secret，不应进版本控制
- 不同用户/团队用各自的 Figma MCP server，不绑定特定实现
- 团队成员各自在 `~/.gemini/config/mcp_config.json` 配自己的 token

如果团队成员需要从零配 MCP，给一份**不含 token** 的模板说明（按你用的 Figma MCP server 替换占位符）：

```json
{
  "mcpServers": {
    "<your-figma-mcp-name>": {
      "command": "npx",
      "args": [
        "-y",
        "<your-figma-mcp-package>",
        "--mcpServer=<your-mcp-server-url>",
        "--accessToken=<your-access-token>"
      ]
    }
  }
}
```

放在 `README.md` 里说明，不放 plugin 实体。

## hooks.json 注意

- 去掉所有 `_` 开头的注释字段（Antigravity 不一定容忍非标准字段）
- `command` 里的 `${REPO_ROOT}` 变量名以 Antigravity 当前版本文档为准；若不支持，用相对路径 `.agents/scripts/dtc-hook.js` 或硬编码绝对路径
- 启用前用 `https://antigravity.google/docs/ide/hooks` 核对 matcher 写法和退出码语义

## 安装与启用

1. 把整个 `design-to-code/` 目录放进 `<repo>/.agents/plugins/`
2. 在 Antigravity IDE 里启用该 plugin（Settings → Plugins 或对应入口）
3. rule 激活模式设为 `Always On` 或 `Model Decision`
4. 用一次故意写 `picsum.photos` 的 Write 验证 hook 是否拦截

## 与用户级安装的关系

- 用户级 `~/.gemini/config/skills/design-to-code`（已软链）让你在任何项目都可用 skill
- plugin 是给**团队**用的：clone repo 后所有人的 skill/rule/hook 一致
- 两者不冲突：plugin 的 workspace 级会补充用户级，同名时按 Antigravity 优先级裁决
