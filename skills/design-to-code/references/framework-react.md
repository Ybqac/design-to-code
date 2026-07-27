# Framework: React + Tailwind / CSS Modules

本文件只在目标框架是 React 时被读取。不重复 SKILL.md 的通用规则，只补 React 特化条款。

## 技术栈识别

动手前先确认项目用的是哪种样式方案，按以下顺序判断：

1. 根目录有 `tailwind.config.{js,ts}` → Tailwind 路线
2. 存在大量 `*.module.css` → CSS Modules 路线
3. 用了 styled-components / emotion / vanilla-extract → 各自的 token 调用方式
4. 都没有 → 优先 CSS Modules（最稳，不依赖外部配置）

## Tailwind 路线

### 数值映射规则

ground-truth.json 的 token 名映射到 Tailwind 类名的优先顺序：

1. 项目 `tailwind.config` 里已经定义的 semantic token（如 `bg-primary` / `text-sm`）→ 直接用
2. 没定义但 ground-truth.json 有 raw 值 → 临时用任意值类 `bg-[#3B82F6]`，并加注释 `/* from nodeId 1:2 */`，同时**在交付说明里建议把它沉淀进 tailwind.config**
3. 都没有 → 走 design-system 默认，并标"截图估读"

### 布局落地

- 容器层级用 `flex` / `grid` 而非 `position: absolute`，除非截图明显是浮层/弹窗
- 截图 fusion 给的 `direction: column` → `flex flex-col`；`align: stretch` → 不加 align-items（默认 stretch）
- 截图的相对间距 `tight/normal/loose` 映射到 `gap-1/2/3` 或 `gap-2/4/8`，**精确像素值必须查 ground-truth**
- 卡片边界用 `rounded-[8px]` 形式或 token，禁凭空 `rounded-lg`（先看 design-system 的 radius 配置）

### 组件规范

- 严格只用 design-system registry 内的组件
- 列表渲染用 `map`，**key 必须用稳定 id 而非 index**（除非 ground-truth 显示是静态列表）
- 状态管理：纯展示组件不引 state，交互态（active/selected）用 props 传入，不自己 `useState`（除非截图明显是受控输入）

```jsx
// ✅ 推荐
export function CardList({ items }) {
  return (
    <div className="flex flex-col gap-4">  /* from nodeId 3:1, gap-md=12 */
      {items.map(it => <Card key={it.id} data={it} />)}
    </div>
  )
}

// ❌ 反例（凭空 state、index 做 key、凭空数值）
export function CardList({ items }) {
  const [selected, setSelected] = useState(0)  // 截图没显示选中态
  return (
    <div className="flex flex-col gap-[13px]"> {/* 凭空像素 */}
      {items.map((it, i) => <Card key={i} data={it} />)}
    </div>
  )
}
```

## CSS Modules 路线

- 每个**视觉上独立的卡片/区块**对应一个 `.module.css` 文件，**不要把整页放一个文件**
- 类名用语义（`.card` `.header` `.actionGroup`），不用布局（`.flex` `.mt4`）
- 数值要么用 CSS 变量（`var(--color-primary)`）要么注释出处 `/* from nodeId 1:2 */`
- 不要在 JSX 里写 `style={{...}}` 内联，除非该值是动态计算

## 文件组织

- 新页面：`src/pages/<PageName>/index.tsx` + 同目录 `*.module.css`
- 复用组件：`src/components/<Name>/index.tsx` + `*.module.css`
- 截图里看到的态（hover/active/disabled/loading）：**只在截图出现过的态才实现**，没出现的态不补
- 图标：截图里的图标走设计系统的 Icon 组件，找匹配的；找不到在 `missing-assets.md` 记下截图位置和 nodeId

## 不做什么

- 不引入新依赖（如 swr / zustand / framer-motion）除非 design-system registry 已用
- 不写单元测试除非项目已有测试基建且用户要求
- 不做响应式断点，除非截图给出了多个尺寸或用户明说
