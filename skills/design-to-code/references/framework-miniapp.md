# Framework: 微信/支付宝小程序

只在目标框架是小程序时被读取。不重复 SKILL.md，补小程序特化。

## 平台识别

1. 根目录 `app.json` + `project.config.json` → 微信小程序；`mini.project.json` → 支付宝小程序
2. 用 Taro / uni-app → 走对应框架的 React/Vue 子集规则，但单位与平台限制同本文件
3. 用原生 → 本文件主线

## 单位与尺寸

- **必须用 `rpx`**（750rpx = 设计稿宽度），不要用 `px`。截图与 ground-truth 给的 px 值要换算：`rpx = px * (750 / 设计稿宽度)`
- 设计稿宽度未知时，默认按 375 设计稿换算（即 `rpx = px * 2`），并在交付说明标注假设
- 字号也用 `rpx`，不用 `pt` / `px`
- 1px 物理边框用 `1rpx` 处理 hairline

```css
/* ✅ 推荐 */
.card {
  border-radius: 16rpx;     /* from nodeId 1:2, 8px@375 设计稿 */
  padding: 24rpx;            /* from nodeId 1:2, 12px */
  background: #3B82F6;       /* from nodeId 1:2 */
  font-size: 28rpx;          /* from nodeId 2:1, 14px */
}

/* ❌ 反例（凭空 px、无出处） */
.card {
  border-radius: 8px;
  font-size: 14px;
  background: blue;
}
```

## 组件规范

- **只能用平台原生组件**：`<view>` / `<text>` / `<image>` / `<scroll-view>` / `<button>` / `<input>` 等，不用 `<div>` `<span>`
- design-system 在小程序里通常是自定义组件库（如 Vant Weapp / TDesign Miniprogram），必须在 design-system registry 列出
- 截图里的按钮：优先用原生 `<button>` 包装，特殊样式才用 `<view>` 模拟
- 图标走 design-system 的 Icon 组件，或截图位置标 `missing-assets.md`

## 配置与生命周期

- 新页面要在 `app.json` 的 `pages` 数组登记
- 页面文件四件套：`.wxml` / `.wxss` / `.js` / `.json`（或 `.ts`）
- 数据用 `data` + `setData`，**禁止直接改 this.data**（不会触发渲染）
- 列表用 `wx:for`，`wx:key` 必须稳定 id，禁止用 index
- 条件渲染 `wx:if` / `hidden`：浮层切换用 `wx:if`，tab 切换已渲染内容用 `hidden`

```wxml
<!-- ✅ 推荐 -->
<view class="card-list flex flex-col gap-24"><!-- from nodeId 3:1 -->
  <card wx:for="{{items}}" wx:key="id" data="{{item}}" />
</view>

<!-- ❌ 反例（index key、凭空样式） -->
<view class="card-list" style="gap: 13px;">
  <card wx:for="{{items}}" wx:key="index" data="{{item}}" />
</view>
```

## 平台限制

- **不支持 flex 的所有属性**：`gap` 在 iOS 低版本不可靠，用 margin 替代
- 不支持 `position: sticky` 部分场景，用 `scroll-view` 配合
- 图片 `<image>` 必须给 `mode`（`aspectFill` / `widthFix` 等），不写会变形
- 网络图片要配 downloadFile 合法域名（交付时在 `missing-assets.md` 标注）
- 截图里图标如果是 SVG，小程序不支持内联，要走 iconfont 或 image 引用

## 不做什么

- 不引新 npm 依赖除非 design-system 已用且支持小程序构建
- 不做 webview / H5 跳转除非截图显示该入口
- 不补截图没出现的 loading / 空状态页面
