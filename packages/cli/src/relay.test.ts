/** 内置 relay 协议测试：join 回包、广播互通、跨客户端命令-响应模拟 */
import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import { startRelay, type RelayHandle } from "./relay-server.js";

let relay: RelayHandle;
const PORT = 3090 + Math.floor(Math.random() * 200);

/** 持久消息队列，消除挂监听时序竞态 */
function queued(ws: WebSocket) {
  const queue: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  return {
    next(timeoutMs = 3000): Promise<any> {
      const m = queue.shift();
      if (m) return Promise.resolve(m);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("消息超时")), timeoutMs);
        waiters.push((msg) => {
          clearTimeout(t);
          resolve(msg);
        });
      });
    },
  };
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

beforeAll(async () => {
  relay = await startRelay(PORT);
});

afterAll(async () => {
  await relay.close();
});

it("join 回包并通知在场成员；广播互通", async () => {
  const a = new WebSocket(`ws://localhost:${PORT}`);
  const qa = queued(a);
  await waitOpen(a);
  a.send(JSON.stringify({ type: "join", channel: "t1", id: "j1" }));
  const welcome = await qa.next();
  expect(welcome.type).toBe("system"); // welcome
  const joinedStr = await qa.next();
  expect(joinedStr.message).toBe("Joined channel: t1");
  const joinedObj = await qa.next();
  expect(joinedObj.message.result).toBe("Connected to channel: t1");

  const b = new WebSocket(`ws://localhost:${PORT}`);
  const qb = queued(b);
  await waitOpen(b);
  b.send(JSON.stringify({ type: "join", channel: "t1" }));
  (await qb.next()); // welcome
  (await qb.next()); // joined
  (await qb.next()); // connected
  const notify = await qa.next(); // a 收到 b 加入通知
  expect(notify.message).toBe("A new user has joined the channel");

  // 广播互通：a（模拟 CLI）发命令 → b（模拟插件）收到；b 回结果 → a 收到
  a.send(JSON.stringify({ id: "cmd1", type: "message", channel: "t1", message: { id: "cmd1", command: "get_selection", params: {} } }));
  const atB = await qb.next();
  expect(atB.type).toBe("broadcast");
  expect(atB.message.command).toBe("get_selection");
  expect(atB.sender).toBe("peer");
  b.send(JSON.stringify({ id: "cmd1", type: "message", channel: "t1", message: { id: "cmd1", result: { ok: 1 } } }));
  const atA = await qa.next();
  expect(atA.type).toBe("broadcast");
  expect(atA.message.result).toEqual({ ok: 1 });

  a.close();
  b.close();
});

it("未 join 就发消息 → 收到 error", async () => {
  const c = new WebSocket(`ws://localhost:${PORT}`);
  const qc = queued(c);
  await waitOpen(c);
  c.send(JSON.stringify({ id: "x", type: "message", channel: "nope", message: { id: "x", command: "ping" } }));
  const welcome = await qc.next();
  expect(welcome.type).toBe("system");
  const err = await qc.next();
  expect(err.type).toBe("error");
  c.close();
});
