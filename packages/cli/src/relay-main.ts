/**
 * relay 守护进程入口（由 `dtc relay start` 以 detached 子进程拉起）。
 * 日志由父进程重定向到 ~/.dtc/relay.log。
 */
import { startRelay } from "./relay-server.js";

const port = Number(process.env.DTC_RELAY_PORT || 3055);

startRelay(port, (...args) => console.log(new Date().toISOString(), ...args))
  .then(() => {
    console.log(`dtc relay 就绪: ws://localhost:${port}（channel 任意，dtc 工具默认用 "dtc"）`);
  })
  .catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
