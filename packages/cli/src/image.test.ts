import { PNG } from "pngjs";
import { expect, it } from "vitest";
import { fitScreenshot, scaleRefToWidth } from "./image.js";

function paint(width: number, height: number, rgba: [number, number, number, number]): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return png;
}

it("参考图按宽度等比缩放，不拉成截图的高", () => {
  const scaled = scaleRefToWidth(paint(4, 2, [1, 2, 3, 255]), 8);
  expect(scaled.width).toBe(8);
  expect(scaled.height).toBe(4);
});

it("高出设计区的截图被裁掉，不足的部分留空", () => {
  const cropped = fitScreenshot(paint(2, 4, [9, 9, 9, 255]), 2, 2);
  expect(cropped.height).toBe(2);
  expect(cropped.data[3]).toBe(255);

  const padded = fitScreenshot(paint(2, 1, [9, 9, 9, 255]), 2, 2);
  expect(padded.data[0]).toBe(9);
  expect(padded.data[8]).toBe(0);
  expect(padded.data[11]).toBe(0);
});
