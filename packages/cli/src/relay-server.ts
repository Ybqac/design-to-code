/**
 * dtc 内置 relay —— ws://localhost:3055 消息中转。
 *
 * 协议移植自 grab/cursor-talk-to-figma-mcp 的 src/socket.ts（MIT），与其 bun 版完全兼容：
 *  - join:    {"id"?, "type":"join","channel"} → 回 system "Joined channel: X" +
 *             system {id, result:"Connected to channel: X"}，并通知他人 "A new user has joined"
 *  - message: {"id","type":"message","channel","message":{...}} → 广播
 *             {"type":"broadcast","message":{...},"sender":"peer","channel"} 给 channel 内其他成员
 *  - progress_update: 原样转发给 channel 内其他成员
 *  - 断开: 从所有 channel 移除，通知同 channel 他人 "A user has left the channel"
 */
import { WebSocketServer, WebSocket } from "ws";

export interface RelayHandle {
  port: number;
  close(): Promise<void>;
}

export function startRelay(port: number, log: (...args: unknown[]) => void = () => {}): Promise<RelayHandle> {
  return new Promise((resolve, reject) => {
    const channels = new Map<string, Set<WebSocket>>();

    const wss = new WebSocketServer({ port });

    wss.on("error", (err: NodeJS.ErrnoException) => reject(new Error(`relay 端口 ${port} 启动失败: ${err.message}`)));

    wss.on("connection", (ws, req) => {
      log(`client connected: ${req.socket.remoteAddress}`);
      ws.send(JSON.stringify({ type: "system", message: "Please join a channel to start chatting" }));

      ws.on("message", (raw) => {
        let data: any;
        try {
          data = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!data || typeof data.type !== "string") return;

        if (data.type === "join") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            ws.send(JSON.stringify({ type: "error", message: "Channel name is required" }));
          return;
          }
          if (!channels.has(channelName)) channels.set(channelName, new Set());
          const clients = channels.get(channelName)!;
          clients.add(ws);
          log(`joined "${channelName}" (${clients.size} total)`);
          ws.send(JSON.stringify({ type: "system", message: `Joined channel: ${channelName}`, channel: channelName }));
          ws.send(JSON.stringify({
            type: "system",
            message: { id: data.id, result: "Connected to channel: " + channelName },
            channel: channelName,
          }));
          clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "system", message: "A new user has joined the channel", channel: channelName }));
            }
          });
          return;
        }

        if (data.type === "message") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            ws.send(JSON.stringify({ type: "error", message: "Channel name is required" }));
            return;
          }
          const clients = channels.get(channelName);
          if (!clients || !clients.has(ws)) {
            ws.send(JSON.stringify({ type: "error", message: "You must join the channel first" }));
            return;
          }
          let sent = 0;
          clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              sent += 1;
              client.send(JSON.stringify({
                type: "broadcast",
                message: data.message,
                sender: "peer",
                channel: channelName,
              }));
            }
          });
          if (sent === 0) log(`no other clients in "${channelName}"`);
          return;
        }

        if (data.type === "progress_update") {
          const channelName = data.channel;
          if (!channelName) return;
          const clients = channels.get(channelName);
          if (!clients || !clients.has(ws)) return;
          clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(data));
            }
          });
          return;
        }
      });

      ws.on("close", () => {
        channels.forEach((clients, channelName) => {
          if (clients.has(ws)) {
            clients.delete(ws);
            clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "system", message: "A user has left the channel", channel: channelName }));
              }
            });
          }
        });
      });
    });

    wss.on("listening", () => {
      log(`WebSocket server running on port ${port}`);
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            for (const clients of channels.values()) {
              for (const c of clients) c.terminate();
            }
            wss.close(() => res());
          }),
      });
    });
  });
}
