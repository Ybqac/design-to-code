import { rgbaToHex } from "./color.js";

export function filterFigmaNode(node) {
  // dtc 增强：VECTOR 不再整棵丢弃，保留存根（切图走 export_node_as_image）
  if (node.type === "VECTOR") {
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      absoluteBoundingBox: node.absoluteBoundingBox,
    };
  }

  var filtered = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      var processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map(
          (stop) => {
            var processedStop = Object.assign({}, stop);
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            delete processedStop.boundVariables;
            return processedStop;
          }
        );
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      var processedStroke = Object.assign({}, stroke);
      delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  // dtc 增强：描边权重/对齐、独立圆角
  if (node.strokeWeight !== undefined) {
    filtered.strokeWeight = node.strokeWeight;
  }
  if (node.strokeAlign !== undefined) {
    filtered.strokeAlign = node.strokeAlign;
  }
  if (node.individualStrokeWeights !== undefined) {
    filtered.individualStrokeWeights = node.individualStrokeWeights;
  }
  if (node.rectangleCornerRadii !== undefined) {
    filtered.rectangleCornerRadii = node.rectangleCornerRadii;
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  // dtc 增强：透明度 / 可见性 / 裁剪
  if (node.opacity !== undefined) {
    filtered.opacity = node.opacity;
  }
  if (node.visible !== undefined) {
    filtered.visible = node.visible;
  }
  if (node.clipsContent !== undefined) {
    filtered.clipsContent = node.clipsContent;
  }

  // dtc 增强：阴影/模糊（阴影色转 hex）
  if (node.effects && node.effects.length > 0) {
    filtered.effects = node.effects.map((effect) => {
      var processedEffect = Object.assign({}, effect);
      if (processedEffect.color) {
        processedEffect.color = rgbaToHex(processedEffect.color);
      }
      return processedEffect;
    });
  }

  // dtc 增强：auto-layout 全家（布局语义重建的关键字段）
  if (node.layoutMode !== undefined && node.layoutMode !== null) {
    filtered.layoutMode = node.layoutMode;
    if (node.itemSpacing !== undefined) filtered.itemSpacing = node.itemSpacing;
    if (node.paddingTop !== undefined) filtered.paddingTop = node.paddingTop;
    if (node.paddingRight !== undefined) filtered.paddingRight = node.paddingRight;
    if (node.paddingBottom !== undefined) filtered.paddingBottom = node.paddingBottom;
    if (node.paddingLeft !== undefined) filtered.paddingLeft = node.paddingLeft;
    if (node.primaryAxisAlignItems !== undefined) filtered.primaryAxisAlignItems = node.primaryAxisAlignItems;
    if (node.counterAxisAlignItems !== undefined) filtered.counterAxisAlignItems = node.counterAxisAlignItems;
    if (node.primaryAxisSizingMode !== undefined) filtered.primaryAxisSizingMode = node.primaryAxisSizingMode;
    if (node.counterAxisSizingMode !== undefined) filtered.counterAxisSizingMode = node.counterAxisSizingMode;
    if (node.layoutWrap !== undefined) filtered.layoutWrap = node.layoutWrap;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  if (node.children) {
    filtered.children = node.children
      .map((child) => {
        return filterFigmaNode(child);
      })
      .filter((child) => {
        return child !== null;
      });
  }

  return filtered;
}
