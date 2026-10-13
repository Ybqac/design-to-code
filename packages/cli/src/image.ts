/** PNG 工具：解码/编码/最近邻缩放（避免引入图像库依赖） */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

export function readPng(file: string): PNG {
  return PNG.sync.read(fs.readFileSync(file));
}

export function writePng(file: string, png: PNG): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

/** 最近邻缩放（验证环对齐参考图与实现截图尺寸用） */
export function resizePng(src: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      const si = (sy * src.width + sx) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

/** 图片尺寸一致化：把 b 缩放到 a 的尺寸 */
export function alignTo(a: PNG, b: PNG): PNG {
  if (a.width === b.width && a.height === b.height) return b;
  return resizePng(b, a.width, a.height);
}
