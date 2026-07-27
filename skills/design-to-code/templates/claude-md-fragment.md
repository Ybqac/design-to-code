<!-- design-to-code fragment for Claude Code. Copy into ~/.claude/CLAUDE.md. -->

## Design-to-Code

When the task is converting a Figma design or a UI screenshot to frontend code, load and follow the `design-to-code` skill at `~/.claude/skills/design-to-code/SKILL.md` (or `~/.agents/skills/design-to-code/SKILL.md` if shared location is used).

Core rules (full text in the skill):

- **Fusion**: screenshot defines structure & layout; Figma MCP / Dev Mode `design-ground-truth.json` defines exact values. On conflict, structure follows the screenshot, values follow ground-truth.
- **Four anti-fabrication red lines**:
  - No placeholder image URLs (placeholder.com / picsum / via.placeholder / unsplash random). Use `<div>` + `<!-- TODO: nodeId -->` when no asset exists.
  - No invented copy. Only transcribe text visible in the screenshot verbatim.
  - No fabricating components outside the design-system registry. Use registry components, or semantic native tags with a "replace with design-system XXX" comment.
  - No invented exact values. Every color/font-size/radius/spacing must either be in `design-ground-truth.json` (cite nodeId) or be explicitly tagged "screenshot estimate".
- **Verify** before delivery: `node scripts/verify-ground-truth.js <code-dir> design-ground-truth.json` — `[UNMATCHED]` must be zero.
- **Loop**: headless-render the generated page, visually diff against the screenshot, fix structural discrepancies (pixel color diffs are acceptable).
