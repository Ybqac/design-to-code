# Framework: Vue 3 + `<script setup>`

只在目标框架是 Vue 时被读取。不重复 SKILL.md，只补 Vue 特化。

## 技术栈识别

1. `package.json` 有 `vue@3.x` → 用 `<script setup>` + Composition API
2. `vue@2.x` → 用 Options API（本文件不展开，按项目既有风格）
3. 样式：优先 scoped style `<style scoped>`，其次 CSS Modules `<style module>`，最后单文件 css

## 模板规范

- 容器布局用 `<div class="flex flex-col">` 配合 flex / grid，不用 absolute 定位浮层以外的元素
- 截图 fusion 的 `direction: column` → `class="flex flex-col"`；`align: stretch` 默认不写
- 间距精确像素查 ground-truth
- 列表用 `v-for`，**`:key` 必须稳定 id**，禁止用 index 除非确实静态
- 条件渲染 `v-if` / `v-show`：交互态用 `v-show` 已隐藏但保留 DOM 的（如 tab 内容），需要时切换用 `v-if`

```vue
<!-- ✅ 推荐 -->
<script setup lang="ts">
defineProps<{ items: Item[] }>()
</script>

<template>
  <div class="flex flex-col gap-4"><!-- from nodeId 3:1, gap-md=12 -->
    <Card v-for="it in items" :key="it.id" :data="it" />
  </div>
</template>

<style scoped>
.card {
  border-radius: 8px; /* from nodeId 1:2 */
  background: var(--color-primary); /* from nodeId 1:2 */
}
</style>
```

## 组件规范

- 用 `<script setup lang="ts">` + Composition API，不混 Options API
- props 用 `defineProps<{...}>()` 带类型，不用 runtime 声明
- 事件用 `defineEmits`，命名 kebab-case（`'submit'` `'select-item'`）
- 截图显示的交互态（hover/selected）通过 props 传入，组件内不自己 ref 维护选中态除非截图明显是控制器
- slot 优先于 props 渲染子内容；具名 slot 用于 header/footer 区

## 状态与样式

- 纯展示组件不引 `ref` / `reactive`，受控输入才用
- scoped style 类名用语义（`.card` `.title`），不用布局（`.flex`）
- 不在 `:style` 绑定里写硬编码数值，动态值从 props / design-system token 取
- 不用 `!important`，除非截图明显覆盖 design-system 默认（且要在注释里说明来源）

## 文件组织

- 页面：`src/pages/<Name>.vue` 或 `src/views/<Name>.vue`，按项目既有约定
- 组件：`src/components/<Name>.vue`
- composables 放 `src/composables/`，只复用真实出现≥2次的逻辑才抽
- 图标：截图里的图标走 design-system Icon 组件；没有匹配的在 `missing-assets.md` 记录

## 不做什么

- 不引新依赖（pinia / vueuse）除非 design-system registry 已用
- 不做响应式断点除非截图给了多尺寸或用户明说
- 不补截图没出现的态（loading / disabled）
