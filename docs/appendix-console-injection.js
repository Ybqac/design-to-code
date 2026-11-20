// 控制台应急脚本不再在仓库里留一份手抄的插件源码。
//
// 它和 Figma 桌面插件用同一份 plugin/src，由打包命令生成（产物在已 gitignore 的 plugin/build）：
//   dtc plugin build
//   产物：plugin/build/web/console-injection.js
//
// 当前仓库里的 packages/cli/dist 若还是旧的，这条 dtc 命令仍会去读 plugin/src/code.js。
// 在重新构建 CLI 之前，可以用源码入口生成（不写 packages/*/dist）：
//   npx vite-node --eval "import { runPlugin } from './packages/cli/src/cmds/plugin.ts'; await runPlugin('build', {})"
//
// 把生成文件全文粘到 Figma 插件控制台。口令只出现在构建产物里。
// plugin/src/ui.html 与 plugin/src/overlay.js 里的 __DTC_RELAY_TOKEN__ 占位符不要改。
