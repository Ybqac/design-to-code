/**
 * TalkToFigma relay 客户端（ws://localhost:3055）。
 *
 * 协议（逆向自 grab/cursor-talk-to-figma-mcp 的 src/socket.ts）：
 *  - join:    {"id":uuid,"type":"join","channel":"dtc"}
 *             → 回包 {"type":"system","message":{"id":uuid,"result":"Connected to channel: dtc"}}
 *  - command: {"id":uuid,"type":"message","channel","message":{"id":uuid,"command","params"}}
 *  - 响应:    {"type":"broadcast","message":{"id":uuid,"result"|"error"}} —— 按 id 匹配
 *  - 同 channel 多客户端广播扇出：必须忽略 id 不在自家 pending 表里的消息
 *  - channel 无插件时服务端静默丢弃 → 只能靠超时发现（默认 30s，progress 续命 60s）
 */
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export interface RelayOptions {
  url?: string; // 默认 ws://localhost:3055
  timeoutMs?: number; // 命令超时，默认 30000
  joinTimeoutMs?: number; // join 超时，默认 8000
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  armTimer: (ms: number) => void;
}

export class FigmaRelayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private channel = "";
  readonly url: string;
  readonly timeoutMs: number;
  readonly joinTimeoutMs: number;

  constructor(opts: RelayOptions = {}) {
    this.url = opts.url ?? "ws://localhost:3055";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.joinTimeoutMs = opts.joinTimeoutMs ?? 8_000;
  }

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(`${msg}（relay 未启动？在 ~/code/cursor-talk-to-figma-mcp 下运行 bun socket）`));
      };
      ws.on("unexpected-response", (_req, res) => fail(`relay ${this.url} 拒绝连接: HTTP ${res?.statusCode}`));
      ws.on("error", (err) => fail(`无法连接 relay ${this.url}: ${err.message}`));
      ws.on("open", () => {
        settled = true;
        ws.removeAllListeners("error");
        ws.on("error", () => {/* close 统一清理 */});
        this.ws = ws;
        resolve(ws);
      });
      ws.on("message", (data) => this.onMessage(String(data)));
      ws.on("close", () => {
        this.ws = null;
        for (const [, p] of this.pending) p.reject(new Error("relay 连接已关闭"));
        this.pending.clear();
      });
    });
  }

  private settle(id: string, err?: Error, result?: any) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (err) p.reject(err);
    else p.resolve(result);
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "progress_update") {
      const id = msg.message?.id ?? msg.id;
      const p = id ? this.pending.get(id) : undefined;
      if (p) p.armTimer(60_000); // 长命令续命
      return;
    }

    // join 回包：system + message 为对象 {id, result}
    if (msg.type === "system" && msg.message && typeof msg.message === "object" && msg.message.id) {
      const inner = msg.message;
      if (inner.error) this.settle(inner.id, new Error(String(inner.error)));
      else this.settle(inner.id, undefined, inner.result);
      return;
    }

    // 命令响应：broadcast / message，inner 带同请求 id
    if (msg.type === "broadcast" || msg.type === "message") {
      const inner = msg.message ?? {};
      const id = inner.id;
      if (!id || !this.pending.has(id)) return; // 别人的消息，忽略
      if (inner.error) this.settle(id, new Error(typeof inner.error === "string" ? inner.error : JSON.stringify(inner.error)));
      else this.settle(id, undefined, inner.result ?? {});
      return;
    }
  }

  /** 加入 channel（幂等；成功以 relay 回包为准） */
  async join(channel: string): Promise<void> {
    const ws = await this.connect();
    if (this.channel === channel) return;
    const id = randomUUID();
    const ok = new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout;
      const arm = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => this.settle(id, new Error(`join channel "${channel}" 超时（relay 在但无响应）`)), ms);
      };
      arm(this.joinTimeoutMs);
      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        armTimer: arm,
      });
    });
    ws.send(JSON.stringify({ id, type: "join", channel }));
    await ok;
    this.channel = channel;
  }

  /** 发送命令并等待插件响应 */
  async send<T = any>(command: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (!this.channel) throw new Error("先 join(channel)");
    const ws = await this.connect();
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout;
      const arm = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(
          () => this.settle(id, new Error(`命令 ${command} 超时——插件未连接 channel "${this.channel}"，或 Figma 未打开目标文件`)),
          ms,
        );
      };
      arm(timeoutMs ?? this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        armTimer: arm,
      });
      ws.send(JSON.stringify({ id, type: "message", channel: this.channel, message: { id, command, params } }));
    });
  }

  /** 快速探测：relay 是否可达、channel 里是否有插件 */
  async ping(channel = "dtc"): Promise<{ relay: boolean; plugin: boolean; detail?: string }> {
    try {
      await this.join(channel);
    } catch (e: any) {
      return { relay: false, plugin: false, detail: e.message };
    }
    try {
      await this.send("get_document_info", {}, 6_000);
      return { relay: true, plugin: true };
    } catch (e: any) {
      return { relay: true, plugin: false, detail: e.message };
    }
  }

  close() {
    for (const [, p] of this.pending) p.reject(new Error("客户端关闭"));
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
    this.channel = "";
  }
}

/** nodeId 归一化：URL 形式 14669-9900 → 14669:9900 */
export function normalizeNodeId(input: string): string {
  const t = input.trim().replace(/^\?node-id=/, "");
  if (/^\d+:\d+$/.test(t)) return t;
  if (/^\d+-\d+$/.test(t)) return t.replace("-", ":");
  throw new Error(`无效 nodeId: ${input}（期望 14669:9900 或 14669-9900）`);
}

/** nodeId → 文件名安全形式 */
export function nodeIdToFileName(id: string): string {
  return id.replace(/[:/]/g, "_");
}
