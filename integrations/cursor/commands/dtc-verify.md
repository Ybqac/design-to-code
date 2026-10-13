# /dtc-verify —— 只跑视觉回归闭环

对已生成的实现页跑"截图 → diff → 归因 → 修复"循环。参数：$ARGUMENTS（实现页 URL；缺省时尝试从项目推断 dev server 地址）。

1. 调用 `dtc_doctor` 确认环境（.dtc/ 规格包必须已存在，否则提示先跑 /design-to-code）。
2. 调用 `dtc_verify { url: $ARGUMENTS }`。
3. 若 exit=1：读 `dtc_fix_prompt`，按归因逐条修复代码（数值以 .dtc/design-ground-truth.json 为准），回到 2。
4. 若 exit=0：报告收敛分数，结束。
5. 若 exit=2：停止，向用户展示剩余差异清单与 fix-prompt 的归因，请求决策。
