/**
 * CLI 与 MCP 共用的输出通道。
 * 默认实现写到 console，命令行用户看到的文案与以前一致。
 * MCP 传入自己的收集函数，避免在工具执行期间替换全局 console。
 */
export interface Logger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export const consoleLogger: Logger = {
  log: (...args) => {
    console.log(...args);
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};
