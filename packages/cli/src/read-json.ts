import fs from "node:fs";

/** 读盘 JSON。语法错误带上文件路径，不把后续字段访问留成 TypeError。 */
export function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 ${file}: ${message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} 不是合法 JSON: ${message}`);
  }
}

export function parseJsonFile<T>(file: string, parse: (data: unknown) => T): T {
  const data = readJson(file);
  try {
    return parse(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${file}: ${message}`);
  }
}
