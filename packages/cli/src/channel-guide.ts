/** README、dtc setup、dtc plugin install 共用的通道文案。主推桌面 manifest，其余为次级。 */
import path from "node:path";

export function channelGuideLines(distDir: string): string[] {
  return [
    "主推：Figma 桌面 App → Plugins → Development → Import plugin from manifest →",
    `  ${path.join(distDir, "desktop", "manifest.json")}`,
    "次级：",
    `  扩展：解压 ${path.join(distDir, "dtc-bridge-chrome-extension.zip")} → chrome://extensions 开「开发者模式」→ 拖入 chrome-extension 文件夹`,
    `  用户脚本：Tampermonkey 拖入 ${path.join(distDir, "web", "dtc-bridge.user.js")}`,
    `  书签：打开 ${path.join(distDir, "web", "dtc-bridge.bookmarklet.html")}，把按钮拖到书签栏`,
  ];
}
