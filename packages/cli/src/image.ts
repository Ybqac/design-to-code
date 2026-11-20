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

/**
 * 参考图等比缩放到截图宽度。高度跟着原比例走，避免把参考图拉变形后再做 pixelmatch。
 */
export function scaleRefToWidth(src: PNG, width: number): PNG {
  if (src.width <= 0 || src.height <= 0) throw new Error("参考图尺寸无效");
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round((src.height * targetWidth) / src.width));
  if (src.width === targetWidth && src.height === targetHeight) return src;
  return resizePng(src, targetWidth, targetHeight);
}

/**
 * 截图左上对齐放到对比画布。
 * 比画布高的部分（整页多出来的区域）裁掉；比画布矮的部分留空，和参考图对比时记为差异。
 */
export function fitScreenshot(src: PNG, width: number, height: number): PNG {
  if (src.width === width && src.height === height) return src;
  const out = new PNG({ width, height });
  const copyW = Math.min(src.width, width);
  const copyH = Math.min(src.height, height);
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      const si = (y * src.width + x) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}
