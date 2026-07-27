# Anti-Fabrication 清单（完整版）

模型在前端代码生成里最常见的四类捏造，每类配正反例。**这四条是机械检查，不是风格建议**——交付前代码必须逐条过。

## 1. 占位图

**禁止**任何占位图服务 URL：

| 禁用模式 | 原因 |
|---|---|
| `placeholder.com` / `via.placeholder.com` | 暴露未完成，且会调外网 |
| `placehold.co` | 同上 |
| `picsum.photos` / `loremflickr.com` | 假装是真图，最危险 |
| `unsplash.com` 随机图 | 张冠李戴，最容易混进交付 |
| `<img src="logo.png">` 凭空文件名 | 文件不存在，构建破 |

**做法**：

```jsx
// ❌ 反例
<img src="https://picsum.photos/200" alt="avatar" />
<img src="/images/logo.png" />  // 文件不存在

// ✅ 正例
{/* TODO: replace with avatar asset from <nodeId: 12:3>, via Figma export */}
<div className="w-10 h-10 rounded-full bg-gray-200" role="img" aria-label="avatar placeholder" />
```

交付时另外维护一份 `missing-assets.md`，列出所有 TODO 处对应的 nodeId 和建议导出格式（`@2x png` / `svg`）。

## 2. 文案

**禁止**任何不在截图或 ground-truth.json 里出现的文案。常见违例：

- 编产品名/公司名（截图没显示 logo 旁的字就别写）
- 编按钮文案（截图按钮写"确认"，别写成"提交"或"OK"）
- 编错误提示、空状态文案、版权年份、版本号
- 把 lorem ipsum 当真实文案写进代码

**做法**：从截图逐字复制可见文案。截图因裁切看不全时，用 `…` 省略号占位并标 `<!-- 截图被裁，待补全文案 -->`，不在交付说明里编。

```jsx
// ❌ 反例
<button>Submit</button>            // 截图写的是"提交"
<p>© 2024 Acme Inc. All rights reserved.</p>  // 凭空
<Toast>操作成功！</Toast>          // 截图没显示这个态

// ✅ 正例
<button>提交</button>
{/* 截图未显示版权区，待补 */}
```

## 3. 组件

**禁止**新造 design-system 之外的同名组件。常见违例：

- 看到 UI 像按钮就 `<MyButton>`，但项目 design-system 里只有 `<Button>`
- 写一个新 `<Card>` 组件，但项目已有 `<Card>` 接口不同
- 调一个不存在的 `<Modal>` API（如 `open()` 而 design-system 是 `visible` prop）

**做法**：

1. 实现前先列 design-system registry（用户没给就停下来问）
2. registry 内的组件→直接用，按其 API 用
3. registry 没有→用语义化原生标签（`<button>`/`<div>`+className）实现，注释标"待替换为 design-system XXX"
4. **绝不**新造同名组件

```jsx
// ❌ 反例（项目 design-system 是 antd）
<MyButton type="primary">提交</MyButton>      // 凭空造组件
<Card title="...">...</Card>                    // 项目 antd Card 接口不同，凭空造

// ✅ 正例
<Button type="primary" htmlType="submit">提交</Button>
{/* 待替换为 design-system 的 StatCard 组件，当前用语义化 div 临时实现 */}
<div className="rounded-lg border p-4">...</div>
```

## 4. 数值

**禁止**凭空写颜色/字号/圆角/阴影精确值。每个值必须满足以下其一：

- 在 `design-ground-truth.json` 找到出处（标注 `/* from <nodeId> */`）
- 是 design-system registry 列出的 token（如 `text-primary` / `gap-md`）
- 显式标"截图估读，待 Dev Mode 核实"

```jsx
// ❌ 反例
<div className="bg-[#3B82F6] text-[14px] rounded-[8px] shadow-lg">  // 凭空值
  <span className="text-[#FFFFFF]">提交</span>
</div>

// ✅ 正例（ground-truth 锁定）
<div className="bg-primary rounded-md text-sm">  /* from nodeId 1:2, token primary */
  <span className="text-on-primary">提交</span>  /* from nodeId 1:3 */
</div>

// ✅ 正例（无 ground-truth，显式估读）
<div className="bg-blue-500 rounded-md text-sm">  {/* 截图估读，待 Dev Mode 核实 */}
```

## 自查清单（交付前过一遍）

- [ ] 全文 grep `placeholder\.` `picsum\.` `via\.placeholder` `unsplash\.com` → 0 命中
- [ ] 全文搜截图里没出现的中文/英文文案 → 0 命中
- [ ] 用到的所有组件名都在 design-system registry 清单里
- [ ] 跑过一次 `scripts/verify-ground-truth.js`，未匹配值清单为空或已逐条标"估读"

跑 `scripts/verify-ground-truth.js` 可自动完成前两条和第四条的数值部分。
