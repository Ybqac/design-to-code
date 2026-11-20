// 缺参在进具体命令前抛出，调度表不再靠 switch 落到下一个 case。
export function requireParams(message, ok) {
  return (handler) =>
    async function guarded(params) {
      if (!ok(params)) throw new Error(message);
      return handler(params);
    };
}
