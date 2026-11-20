import { requireParams } from "./params.js";
import {
  getAnnotations,
  scanNodesByTypes,
  setAnnotation,
  setMultipleAnnotations,
} from "./annotations.js";
import {
  createComponentInstance,
  exportNodeAsImage,
  getLocalComponents,
  getStyles,
} from "./components.js";
import { createConnections, setDefaultConnector, setFocus, setSelections } from "./connections.js";
import { createFrame, createRectangle, createSection, createText } from "./create.js";
import { getDocumentInfo, getNodeInfo, getNodesInfo, getSelection, readMyDesign } from "./document.js";
import { getInstanceOverridesCommand, setInstanceOverridesCommand } from "./instances.js";
import {
  setAxisAlign,
  setItemSpacing,
  setLayoutMode,
  setLayoutSizing,
  setPadding,
} from "./layout.js";
import {
  cloneNode,
  deleteMultipleNodes,
  deleteNode,
  moveNode,
  renameNode,
  resizeNode,
  setParent,
} from "./nodes.js";
import { setCornerRadius, setFillColor, setImageFill, setStrokeColor } from "./paint.js";
import { getReactions } from "./reactions.js";
import { scanTextNodes } from "./text-scan.js";
import { setMultipleTextContents, setTextContent } from "./text.js";

const missingNodeId = requireParams(
  "Missing nodeId parameter",
  (params) => !!(params && params.nodeId),
);

const missingNodeIds = requireParams(
  "Missing or invalid nodeIds parameter",
  (params) => !!(params && params.nodeIds && Array.isArray(params.nodeIds)),
);

const missingTargetNodeIds = requireParams(
  "Missing targetNodeIds parameter",
  (params) => !!(params && params.targetNodeIds),
);

export const commands = {
  get_document_info: () => getDocumentInfo(),
  get_selection: () => getSelection(),
  get_node_info: missingNodeId((params) => getNodeInfo(params.nodeId)),
  get_nodes_info: missingNodeIds((params) => getNodesInfo(params.nodeIds)),
  read_my_design: () => readMyDesign(),
  create_rectangle: createRectangle,
  create_frame: createFrame,
  create_text: createText,
  set_fill_color: setFillColor,
  set_stroke_color: setStrokeColor,
  move_node: moveNode,
  resize_node: resizeNode,
  delete_node: deleteNode,
  delete_multiple_nodes: deleteMultipleNodes,
  get_styles: () => getStyles(),
  get_local_components: getLocalComponents,
  create_component_instance: createComponentInstance,
  export_node_as_image: exportNodeAsImage,
  set_corner_radius: setCornerRadius,
  set_text_content: setTextContent,
  clone_node: cloneNode,
  scan_text_nodes: scanTextNodes,
  set_multiple_text_contents: setMultipleTextContents,
  get_annotations: getAnnotations,
  set_annotation: setAnnotation,
  scan_nodes_by_types: scanNodesByTypes,
  set_multiple_annotations: setMultipleAnnotations,
  get_instance_overrides: getInstanceOverridesCommand,
  set_instance_overrides: missingTargetNodeIds(setInstanceOverridesCommand),
  set_layout_mode: setLayoutMode,
  set_padding: setPadding,
  set_axis_align: setAxisAlign,
  set_layout_sizing: setLayoutSizing,
  set_item_spacing: setItemSpacing,
  get_reactions: missingNodeIds((params) => getReactions(params.nodeIds)),
  set_default_connector: setDefaultConnector,
  create_connections: createConnections,
  set_focus: setFocus,
  set_selections: setSelections,
  set_image_fill: setImageFill,
  rename_node: renameNode,
  create_section: createSection,
  set_parent: setParent,
};

export async function handleCommand(command, params) {
  const handler = commands[command];
  if (!handler) throw new Error(`Unknown command: ${command}`);
  return handler(params);
}
