/**
 * dtc sel —— 查看当前 Figma 选区（本地直接知道选中了什么）。
 */
import { FigmaRelayClient } from "../ws-client.js";

export interface SelOptions {
  channel?: string;
  url?: string;
}

export interface SelectionNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
}

/** 拉取当前选区（get_selection） */
export async function fetchSelection(channel = "dtc", url?: string): Promise<SelectionNode[]> {
  const client = new FigmaRelayClient(url ? { url } : {});
  try {
    await client.join(channel);
    const res = await client.send<any>("get_selection", {}, 10_000);
    const sel = Array.isArray(res?.selection) ? res.selection : [];
    return sel;
  } finally {
    client.close();
  }
}

export async function runSel(opts: SelOptions): Promise<number> {
  const channel = opts.channel ?? "dtc";
  console.log(`→ channel "${channel}" get_selection ...`);
  const sel = await fetchSelection(channel, opts.url);
  if (sel.length === 0) {
    console.log("（未选中节点）—— 在 Figma 里点选图层后重跑，或用面板查看实时选区");
    return 1;
  }
  console.log(`\n选中 ${sel.length} 个节点：`);
  for (const n of sel) {
    console.log(`  ${n.id.padEnd(16)} ${String(n.type).padEnd(12)} ${n.name}`);
  }
  console.log(`\n提取第一个：dtc extract --node ${sel[0].id.replace(":", "-")}`);
  if (sel.length > 1) {
    console.log(`提取其他：`);
    for (const n of sel.slice(1)) console.log(`  dtc extract --node ${n.id.replace(":", "-")}   # ${n.name}`);
  }
  console.log(`或直接：dtc extract --selection`);
  return 0;
}
