/**
 * dtc relay —— 内置 relay 守护进程管理（start / stop / status）。
 *
 * 端口 3055 已有监听（bun socket 或自身已起）→ 视为就绪复用，不重复启动。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DTC_HOME = path.join(os.homedir(), ".dtc");
const LOG_FILE = path.join(DTC_HOME, "relay.log");
const PID_FILE = path.join(DTC_HOME, "relay.pid");
const PORT = 3055;

export function relayUp(port = PORT, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function readPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runRelay(action: string): Promise<number> {
  if (action === "status") {
    const up = await relayUp();
    const pid = readPid();
    console.log(`relay(3055): ${up ? "✅ 运行中" : "❌ 未启动"}${pid && pidAlive(pid) ? `（dtc pid ${pid}）` : up ? "（非 dtc 拉起，如 bun socket）" : ""}`);
    if (up) console.log(`日志: ${LOG_FILE}`);
    else console.log(`启动: dtc relay start`);
    return up ? 0 : 1;
  }

  if (action === "start") {
    if (await relayUp()) {
      console.log(`✅ relay 已在运行（ws://localhost:${PORT}），复用不重复启动`);
      return 0;
    }
    fs.mkdirSync(DTC_HOME, { recursive: true });
    const relayJs = path.join(path.dirname(fileURLToPath(import.meta.url)), "relay-main.js");
    if (!fs.existsSync(relayJs)) throw new Error(`找不到 ${relayJs}（先 npm run build）`);
    const out = fs.openSync(LOG_FILE, "a");
    const child = spawn(process.execPath, [relayJs], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env },
    });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));
    // 等待就绪
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await relayUp()) {
        console.log(`✅ relay 已启动（pid ${child.pid}，ws://localhost:${PORT}，日志 ${LOG_FILE}）`);
        return 0;
      }
    }
    console.error(`❌ relay 启动超时，日志尾部：`);
    try {
      console.error(fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-10).join("\n"));
    } catch { /* ignore */ }
    return 1;
  }

  if (action === "stop") {
    const pid = readPid();
    if (pid && pidAlive(pid)) {
      process.kill(pid, "SIGTERM");
      fs.rmSync(PID_FILE, { force: true });
      console.log(`✅ relay 已停止（pid ${pid}）`);
      return 0;
    }
    fs.rmSync(PID_FILE, { force: true });
    if (await relayUp()) {
      console.log(`⚠️ 3055 仍有监听但不是 dtc 拉起的（可能是 bun socket），请手动停止`);
      return 1;
    }
    console.log(`relay 未在运行`);
    return 0;
  }

  console.error(`用法: dtc relay <start|stop|status>`);
  return 2;
}
