/**
 * Yasuda Figma MCP — Figma plugin (main thread).
 *
 * This sandbox has the Figma document APIs but NO network access. It receives
 * read-only operations from ui.html (which holds the WebSocket to the bridge),
 * executes them against the LOCAL document, and posts the result back to the UI
 * to be relayed to the MCP server. Screenshots use exportAsync — the exact same
 * local renderer as right-click -> "Copy as PNG" — so nothing is uploaded to S3
 * or any external service.
 */

figma.showUI(__html__, { width: 360, height: 460, themeColors: true });

// Restore saved connection settings and send editor context to the UI.
(async () => {
  let settings = null;
  try {
    settings = await figma.clientStorage.getAsync("bridgeSettings");
  } catch (e) {
    // ignore
  }
  figma.ui.postMessage({ type: "settings", settings: settings || null });
  figma.ui.postMessage({ type: "editor-context", editorType: figma.editorType });
})();

figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "save-settings") {
    try {
      await figma.clientStorage.setAsync("bridgeSettings", msg.settings);
    } catch (e) {
      // ignore
    }
    return;
  }

  if (msg.type === "request") {
    let response;
    try {
      const result = await handleRequest(msg.op, msg.params || {});
      response = { type: "response", requestId: msg.requestId, ok: true, result };
    } catch (e) {
      response = { type: "response", requestId: msg.requestId, ok: false, error: errMsg(e) };
    }
    figma.ui.postMessage(response);
  }
};

// ---------------------------------------------------------------------------
// Operation dispatch
// ---------------------------------------------------------------------------

async function handleRequest(op, params) {
  switch (op) {
    case "screenshot":
      return handleScreenshot(params);
    case "export_node":
      return handleExportNode(params);
    case "metadata":
      return handleMetadata(params);
    case "design_context":
      return handleDesignContext(params);
    case "variable_defs":
      return handleVariableDefs(params);
    case "search_design_system":
      return handleSearch(params);
    case "list_component_sets":
      return handleListComponentSets(params);
    case "libraries":
      return handleLibraries();
    case "figjam":
      return handleFigjam(params);
    case "document_info":
      return handleDocumentInfo();
    case "whoami":
      return handleWhoami();
    default:
      throw new Error("Unknown op: " + op);
  }
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

async function resolveTargetNodes(target) {
  if (target && target.kind === "node") {
    const node = await figma.getNodeByIdAsync(target.nodeId);
    if (!node) throw new Error("Node not found: " + target.nodeId + ". Is this file/page open?");
    return [node];
  }
  const sel = figma.currentPage.selection.slice();
  if (!sel.length) {
    throw new Error("Nothing is selected in Figma. Select a layer/frame, or pass a nodeId/url.");
  }
  return sel;
}

// ---------------------------------------------------------------------------
// screenshot
// ---------------------------------------------------------------------------

async function handleScreenshot(params) {
  const nodes = await resolveTargetNodes(params.target);
  const scale = clampNum(params.scale, 1, 4, 2);
  const format = params.format === "JPG" ? "JPG" : "PNG";
  const images = [];
  for (const node of nodes) {
    if (!("exportAsync" in node)) continue;
    const bytes = await node.exportAsync({ format, constraint: { type: "SCALE", value: scale } });
    images.push({
      nodeId: node.id,
      name: node.name,
      data: figma.base64Encode(bytes),
      mimeType: format === "JPG" ? "image/jpeg" : "image/png",
      width: Math.round(node.width),
      height: Math.round(node.height),
    });
  }
  if (!images.length) throw new Error("No exportable node found (selection empty or node not exportable).");
  return { images };
}

// ---------------------------------------------------------------------------
// export_node — vector SVG (default) or raster PNG/JPG of a node, produced
// LOCALLY via exportAsync and returned inline (no upload). SVG bytes are passed
// as base64 (the plugin sandbox lacks a reliable UTF-8 decoder); the MCP server
// decodes them back to SVG markup.
// ---------------------------------------------------------------------------

async function handleExportNode(params) {
  const nodes = await resolveTargetNodes(params.target);
  const format = String(params.format || "SVG").toUpperCase();
  const scale = clampNum(params.scale, 1, 4, 2);
  const assets = [];
  for (const node of nodes) {
    if (!("exportAsync" in node)) continue;
    if (format === "SVG") {
      const bytes = await node.exportAsync({ format: "SVG" });
      assets.push({ nodeId: node.id, name: node.name, format: "SVG", svgBase64: figma.base64Encode(bytes) });
    } else {
      const fmt = format === "JPG" ? "JPG" : "PNG";
      const bytes = await node.exportAsync({ format: fmt, constraint: { type: "SCALE", value: scale } });
      assets.push({
        nodeId: node.id,
        name: node.name,
        format: fmt,
        mimeType: fmt === "JPG" ? "image/jpeg" : "image/png",
        data: figma.base64Encode(bytes),
        width: Math.round(node.width),
        height: Math.round(node.height),
      });
    }
  }
  if (!assets.length) throw new Error("No exportable node found for the target.");
  return { assets };
}

// ---------------------------------------------------------------------------
// metadata (compact tree)
// ---------------------------------------------------------------------------

async function handleMetadata(params) {
  const nodes = await resolveTargetNodes(params.target);
  const depth = typeof params.depth === "number" ? params.depth : 6;
  return { count: nodes.length, nodes: nodes.map((n) => metaNode(n, 0, depth)) };
}

function metaNode(node, depth, maxDepth) {
  const o = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false };
  if ("width" in node) {
    o.x = round(node.x);
    o.y = round(node.y);
    o.width = round(node.width);
    o.height = round(node.height);
  }
  if ("children" in node && node.children.length) {
    if (depth < maxDepth) {
      o.children = node.children.map((c) => metaNode(c, depth + 1, maxDepth));
    } else {
      o.childCount = node.children.length;
    }
  }
  return o;
}

// ---------------------------------------------------------------------------
// design_context (deep serialization for codegen)
// ---------------------------------------------------------------------------

async function handleDesignContext(params) {
  resetVarCache();
  resetStyleCache();
  const nodes = await resolveTargetNodes(params.target);
  const depth = typeof params.depth === "number" ? params.depth : 4;
  const out = [];
  for (const n of nodes) out.push(await ctxNode(n, 0, depth));
  return { count: out.length, nodes: out };
}

async function ctxNode(node, depth, maxDepth) {
  const o = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false };

  if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
    const b = node.absoluteBoundingBox;
    o.bounds = { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) };
  } else if ("width" in node) {
    o.size = { width: round(node.width), height: round(node.height) };
  }
  if ("opacity" in node && node.opacity !== 1) o.opacity = round(node.opacity);
  if ("rotation" in node && node.rotation) o.rotation = round(node.rotation);
  if ("blendMode" in node && node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
    o.blendMode = node.blendMode;
  }
  if ("constraints" in node) o.constraints = node.constraints;
  if ("clipsContent" in node) o.clipsContent = node.clipsContent;
  if ("isMask" in node && node.isMask) {
    o.isMask = true;
    if ("maskType" in node && node.maskType) o.maskType = node.maskType;
  }
  if ("locked" in node && node.locked) o.locked = true;
  // Full transform matrix relative to the parent — only when rotated/skewed
  // (otherwise bounds + x/y already convey position).
  if ("relativeTransform" in node && node.rotation) o.relativeTransform = node.relativeTransform;
  // Prototyping interactions (compact summary).
  if ("reactions" in node && Array.isArray(node.reactions) && node.reactions.length) {
    o.reactions = node.reactions.map((r) => {
      const acts = r.actions || (r.action ? [r.action] : []);
      return {
        trigger: r.trigger ? r.trigger.type : undefined,
        actions: acts.map((a) => ({ type: a.type, destinationId: a.destinationId, navigation: a.navigation })),
      };
    });
  }

  const layout = layoutObj(node);
  if (layout) o.layout = layout;
  if ("layoutGrids" in node && node.layoutGrids && node.layoutGrids.length) o.layoutGrids = gridsToArr(node.layoutGrids);
  if ("layoutSizingHorizontal" in node) {
    o.layoutSizing = { horizontal: node.layoutSizingHorizontal, vertical: node.layoutSizingVertical };
  }
  // Per-child auto-layout behaviour (relative to the parent's auto-layout).
  if ("layoutAlign" in node && node.layoutAlign && node.layoutAlign !== "INHERIT") o.layoutAlign = node.layoutAlign;
  if ("layoutGrow" in node && node.layoutGrow) o.layoutGrow = node.layoutGrow;
  if ("layoutPositioning" in node && node.layoutPositioning && node.layoutPositioning !== "AUTO") {
    o.layoutPositioning = node.layoutPositioning;
  }
  for (const k of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) {
    if (k in node && typeof node[k] === "number") o[k] = round(node[k]);
  }

  if ("fills" in node) {
    const f = paintsToArr(node.fills);
    if (f) o.fills = f;
  }
  if ("strokes" in node && node.strokes && node.strokes.length) {
    o.strokes = paintsToArr(node.strokes);
    o.strokeWeight = node.strokeWeight === figma.mixed ? "mixed" : node.strokeWeight;
    if (node.strokeWeight === figma.mixed) {
      o.strokeWeights = {
        top: node.strokeTopWeight,
        right: node.strokeRightWeight,
        bottom: node.strokeBottomWeight,
        left: node.strokeLeftWeight,
      };
    }
    o.strokeAlign = node.strokeAlign;
    if ("strokeCap" in node && node.strokeCap && node.strokeCap !== figma.mixed && node.strokeCap !== "NONE") {
      o.strokeCap = node.strokeCap;
    }
    if ("strokeJoin" in node && node.strokeJoin && node.strokeJoin !== figma.mixed) o.strokeJoin = node.strokeJoin;
    if ("dashPattern" in node && node.dashPattern && node.dashPattern.length) o.dashPattern = node.dashPattern;
  }
  if ("effects" in node && node.effects && node.effects.length) o.effects = effectsToArr(node.effects);
  const cr = cornerRadius(node);
  if (cr !== undefined) o.cornerRadius = cr;
  if ("cornerSmoothing" in node && node.cornerSmoothing) o.cornerSmoothing = round(node.cornerSmoothing);

  const styles = await stylesObj(node);
  if (styles) o.styles = styles;
  if ("exportSettings" in node && node.exportSettings && node.exportSettings.length) {
    o.exportSettings = node.exportSettings.map((s) => ({ format: s.format, suffix: s.suffix, constraint: s.constraint }));
  }

  if (node.type === "TEXT") o.text = textObj(node);

  const comp = await componentObj(node);
  if (comp) o.component = comp;

  const bv = await boundVarsObj(node);
  if (bv) o.boundVariables = bv;

  if ("children" in node && node.children.length) {
    if (depth < maxDepth) {
      o.children = [];
      for (const c of node.children) o.children.push(await ctxNode(c, depth + 1, maxDepth));
    } else {
      o.childCount = node.children.length;
    }
  }
  return o;
}

// ---------------------------------------------------------------------------
// variable_defs
// ---------------------------------------------------------------------------

async function handleVariableDefs(params) {
  resetVarCache();
  const collections = {};
  async function addCollection(id) {
    if (!id || collections[id]) return;
    try {
      const c = await withTimeout(figma.variables.getVariableCollectionByIdAsync(id), 2500, null);
      if (c) collections[id] = { id: c.id, name: c.name, modes: c.modes, defaultModeId: c.defaultModeId };
    } catch (e) {
      // ignore
    }
  }
  const map = await localVarMap(); // bulk, instead of one (hang-prone) lookup per id
  function varInfo(v) {
    return {
      id: v.id,
      name: v.name,
      key: v.key,
      resolvedType: v.resolvedType,
      collectionId: v.variableCollectionId,
      valuesByMode: resolveValuesByMode(v.valuesByMode, map),
      description: v.description || undefined,
    };
  }

  if (params.scope === "all") {
    const vars = Object.keys(map).map((k) => map[k]);
    for (const v of vars) await addCollection(v.variableCollectionId);
    return { scope: "all", count: vars.length, variables: vars.map(varInfo), collections: values(collections) };
  }

  const nodes = await resolveTargetNodes(params.target);
  const ids = {};
  collectBoundVariableIds(nodes, ids);
  const variables = [];
  for (const id of Object.keys(ids)) {
    const v = map[id];
    if (v) {
      variables.push(varInfo(v));
      await addCollection(v.variableCollectionId);
    } else {
      // Bound to a remote/library variable we can't resolve locally — still
      // report the id so the binding isn't lost.
      variables.push({ id, name: undefined, remote: true });
    }
  }
  return { scope: "target", count: variables.length, variables, collections: values(collections) };
}

// Resolve VARIABLE_ALIAS entries in a variable's valuesByMode to
// { alias, aliasName } (one level) so token chains are readable. Literal values
// pass through unchanged.
function resolveValuesByMode(vbm, map) {
  if (!vbm || typeof vbm !== "object") return vbm;
  const out = {};
  for (const mode of Object.keys(vbm)) {
    const val = vbm[mode];
    if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS" && val.id) {
      const t = map[val.id];
      out[mode] = { alias: val.id, aliasName: t ? t.name : undefined };
    } else {
      out[mode] = val;
    }
  }
  return out;
}

function collectBoundVariableIds(nodes, acc) {
  for (const node of nodes) {
    const bv = node.boundVariables;
    if (bv && typeof bv === "object") {
      for (const prop of Object.keys(bv)) {
        const entry = bv[prop];
        const arr = Array.isArray(entry) ? entry : [entry];
        for (const a of arr) if (a && a.id) acc[a.id] = true;
      }
    }
    if ("children" in node && node.children.length) collectBoundVariableIds(node.children, acc);
  }
}

// ---------------------------------------------------------------------------
// search_design_system
// ---------------------------------------------------------------------------

async function handleSearch(params) {
  const q = String(params.query || "").toLowerCase();
  const kinds = params.kinds || ["component", "style"];
  const limit = clampNum(params.limit, 1, 200, 50);
  const results = [];

  if (kinds.indexOf("component") !== -1) {
    // dynamic-page docs throw on figma.root traversal until all pages are loaded.
    // Without this, allPages would silently return an empty list.
    if (params.allPages) {
      try {
        await figma.loadAllPagesAsync();
      } catch (e) {
        // ignore — fall back to whatever is already loaded
      }
    }
    const root = params.allPages ? figma.root : figma.currentPage;
    let comps = [];
    try {
      comps = root.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
    } catch (e) {
      // ignore
    }
    for (const c of comps) {
      if (!q || c.name.toLowerCase().indexOf(q) !== -1) {
        results.push({ kind: "component", type: c.type, id: c.id, name: c.name, key: c.key || undefined });
        if (results.length >= limit) return finishSearch(params.query, results, true);
      }
    }
  }

  if (kinds.indexOf("style") !== -1) {
    const styleSets = [
      ["PAINT", await safeStyles(figma.getLocalPaintStylesAsync)],
      ["TEXT", await safeStyles(figma.getLocalTextStylesAsync)],
      ["EFFECT", await safeStyles(figma.getLocalEffectStylesAsync)],
    ];
    for (const pair of styleSets) {
      for (const s of pair[1]) {
        if (!q || s.name.toLowerCase().indexOf(q) !== -1) {
          results.push({ kind: "style", styleType: pair[0], id: s.id, name: s.name, key: s.key || undefined });
          if (results.length >= limit) return finishSearch(params.query, results, true);
        }
      }
    }
  }
  return finishSearch(params.query, results);
}

function finishSearch(query, results, truncated) {
  const out = { query, count: results.length, results };
  if (truncated) out.truncated = true;
  return out;
}

async function safeStyles(getter) {
  try {
    return await getter();
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// list_component_sets (variant defs + exact property keys for planning writes)
// ---------------------------------------------------------------------------

async function handleListComponentSets(params) {
  const q = String(params.query || "").toLowerCase();
  const limit = clampNum(params.limit, 1, 200, 50);

  // dynamic-page docs throw on figma.root traversal until all pages are loaded.
  // Without this, allPages would silently return an empty list.
  if (params.allPages) {
    try {
      await figma.loadAllPagesAsync();
    } catch (e) {
      // ignore — fall back to whatever is already loaded
    }
  }
  const root = params.allPages ? figma.root : figma.currentPage;

  let nodes = [];
  try {
    nodes = root.findAllWithCriteria({ types: ["COMPONENT_SET", "COMPONENT"] });
  } catch (e) {
    // ignore
  }

  const componentSets = [];
  const components = [];
  let truncated = false;
  for (const n of nodes) {
    if (q && n.name.toLowerCase().indexOf(q) === -1) continue;
    if (componentSets.length + components.length >= limit) {
      truncated = true;
      break;
    }
    if (n.type === "COMPONENT_SET") {
      componentSets.push({
        id: n.id,
        name: n.name,
        key: n.key || undefined,
        variantCount: "children" in n ? n.children.length : 0,
        properties: propDefs(n),
      });
    } else if (n.type === "COMPONENT") {
      // Skip variants that live inside a set — the set already represents them.
      if (n.parent && n.parent.type === "COMPONENT_SET") continue;
      components.push({ id: n.id, name: n.name, key: n.key || undefined, properties: propDefs(n) });
    }
  }
  const out = { count: componentSets.length + components.length, componentSets, components };
  if (truncated) out.truncated = true;
  return out;
}

// Summarize componentPropertyDefinitions. Keys are the EXACT Figma keys: a plain
// name for VARIANT, "name#id" for TEXT/BOOLEAN/INSTANCE_SWAP. We also expose the
// friendly name so the agent can author specs by name and still see the exact key.
function propDefs(node) {
  let defs = null;
  try {
    defs = node.componentPropertyDefinitions;
  } catch (e) {
    return undefined;
  }
  if (!defs) return undefined;
  const out = {};
  for (const key of Object.keys(defs)) {
    const d = defs[key];
    const o = { type: d.type, name: friendlyPropName(key) };
    if (d.defaultValue !== undefined) o.default = d.defaultValue;
    if (d.variantOptions) o.options = d.variantOptions;
    if (d.type === "INSTANCE_SWAP" && d.preferredValues) o.preferredValues = d.preferredValues;
    out[key] = o;
  }
  return out;
}

function friendlyPropName(key) {
  const i = key.indexOf("#");
  return i === -1 ? key : key.slice(0, i);
}

// ---------------------------------------------------------------------------
// libraries
// ---------------------------------------------------------------------------

async function handleLibraries() {
  const note =
    "Figma's plugin API only exposes team-library VARIABLE collections. Full component-library enumeration is not available to plugins; use the official MCP or REST API for that.";
  try {
    const cols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    return {
      note,
      libraryVariableCollections: cols.map((c) => ({ key: c.key, name: c.name, libraryName: c.libraryName })),
    };
  } catch (e) {
    return { note, error: errMsg(e), libraryVariableCollections: [] };
  }
}

// ---------------------------------------------------------------------------
// figjam
// ---------------------------------------------------------------------------

async function handleFigjam(params) {
  let nodes;
  if (params.target && params.target.kind === "node") {
    nodes = await resolveTargetNodes(params.target);
  } else if (figma.currentPage.selection.length) {
    nodes = figma.currentPage.selection.slice();
  } else {
    nodes = figma.currentPage.children.slice();
  }
  return { page: figma.currentPage.name, count: nodes.length, nodes: nodes.map(figjamNode) };
}

function figjamNode(node) {
  const o = { id: node.id, name: node.name, type: node.type };
  if (node.type === "TEXT" && "characters" in node) {
    o.text = node.characters;
  } else if ("text" in node && node.text && "characters" in node.text) {
    o.text = node.text.characters;
  }
  if ("x" in node) {
    o.x = round(node.x);
    o.y = round(node.y);
  }
  if ("width" in node) {
    o.width = round(node.width);
    o.height = round(node.height);
  }
  if (node.type === "CONNECTOR") {
    o.connectorStart = endpointId(node.connectorStart);
    o.connectorEnd = endpointId(node.connectorEnd);
  }
  if ("children" in node && node.children.length) o.children = node.children.map(figjamNode);
  return o;
}

function endpointId(ep) {
  if (ep && ep.endpointNodeId) return ep.endpointNodeId;
  return undefined;
}

// ---------------------------------------------------------------------------
// document_info / whoami
// ---------------------------------------------------------------------------

async function handleDocumentInfo() {
  // Under documentAccess: "dynamic-page", reading a non-current page's `children`
  // throws until that page is loaded — so only count the current page's children.
  const curId = figma.currentPage.id;
  const pages = figma.root.children.map((p) => {
    const o = { id: p.id, name: p.name };
    if (p.id === curId && "children" in p) o.childCount = p.children.length;
    return o;
  });
  return {
    fileName: figma.root.name,
    editorType: figma.editorType,
    currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
    pages,
    selection: figma.currentPage.selection.map((n) => ({ id: n.id, name: n.name, type: n.type })),
  };
}

async function handleWhoami() {
  const u = figma.currentUser;
  return {
    user: u ? { id: u.id, name: u.name, photoUrl: u.photoUrl, color: u.color } : null,
    note: u
      ? undefined
      : "figma.currentUser is null (the plugin may lack permission or run in a context without a user).",
    editorType: figma.editorType,
    fileName: figma.root.name,
    currentPage: figma.currentPage.name,
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function round(n) {
  return typeof n === "number" ? Math.round(n * 100) / 100 : n;
}

function clampNum(v, min, max, fallback) {
  const n = typeof v === "number" ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function values(obj) {
  return Object.keys(obj).map((k) => obj[k]);
}

function errMsg(e) {
  return e && e.message ? String(e.message) : String(e);
}

function rgbToHex(c) {
  const h = (x) => {
    const v = Math.round((x || 0) * 255);
    return (v < 16 ? "0" : "") + v.toString(16);
  };
  return "#" + h(c.r) + h(c.g) + h(c.b);
}

function paintToObj(p) {
  if (!p) return null;
  const o = { type: p.type, visible: p.visible !== false, opacity: typeof p.opacity === "number" ? p.opacity : 1 };
  if (p.blendMode && p.blendMode !== "NORMAL") o.blendMode = p.blendMode;
  if (p.type === "SOLID") {
    o.color = rgbToHex(p.color);
  } else if (typeof p.type === "string" && p.type.indexOf("GRADIENT") === 0) {
    o.stops = (p.gradientStops || []).map((s) => ({
      position: round(s.position),
      color: rgbToHex(s.color),
      a: round(s.color.a),
    }));
    if (p.gradientTransform) o.gradientTransform = p.gradientTransform;
  } else if (p.type === "IMAGE") {
    o.scaleMode = p.scaleMode;
    o.imageHash = p.imageHash;
    if (p.imageTransform) o.imageTransform = p.imageTransform;
    if (typeof p.scalingFactor === "number") o.scalingFactor = p.scalingFactor;
    if (typeof p.rotation === "number" && p.rotation) o.rotation = p.rotation;
    if (p.filters) o.filters = p.filters;
  }
  // Variable bindings on the paint itself (e.g. a fill colour bound to a token).
  if (p.boundVariables && typeof p.boundVariables === "object" && Object.keys(p.boundVariables).length) {
    o.boundVariables = p.boundVariables;
  }
  return o;
}

function paintsToArr(paints) {
  if (paints === figma.mixed) return "mixed";
  if (!Array.isArray(paints)) return undefined;
  if (!paints.length) return undefined;
  return paints.map(paintToObj);
}

function effectsToArr(effects) {
  return effects.map((e) => {
    const o = { type: e.type, visible: e.visible !== false };
    if (typeof e.radius === "number") o.radius = round(e.radius);
    if (e.color) {
      o.color = rgbToHex(e.color);
      o.a = round(e.color.a);
    }
    if (e.offset) o.offset = { x: round(e.offset.x), y: round(e.offset.y) };
    if (typeof e.spread === "number") o.spread = e.spread;
    if (e.blendMode && e.blendMode !== "NORMAL") o.blendMode = e.blendMode;
    if (typeof e.showShadowBehindNode === "boolean") o.showShadowBehindNode = e.showShadowBehindNode;
    return o;
  });
}

function cornerRadius(node) {
  if (!("cornerRadius" in node)) return undefined;
  if (node.cornerRadius === figma.mixed) {
    return {
      topLeft: node.topLeftRadius,
      topRight: node.topRightRadius,
      bottomRight: node.bottomRightRadius,
      bottomLeft: node.bottomLeftRadius,
    };
  }
  return node.cornerRadius || undefined;
}

function layoutObj(node) {
  if (!("layoutMode" in node) || node.layoutMode === "NONE") return undefined;
  const o = {
    mode: node.layoutMode,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    primaryAxisSizingMode: node.primaryAxisSizingMode,
    counterAxisSizingMode: node.counterAxisSizingMode,
    layoutWrap: node.layoutWrap,
    itemSpacing: node.itemSpacing,
    padding: {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft,
    },
  };
  if (node.layoutWrap === "WRAP" && typeof node.counterAxisSpacing === "number") o.counterAxisSpacing = node.counterAxisSpacing;
  if ("counterAxisAlignContent" in node && node.counterAxisAlignContent && node.counterAxisAlignContent !== "AUTO") {
    o.counterAxisAlignContent = node.counterAxisAlignContent;
  }
  if ("itemReverseZIndex" in node && node.itemReverseZIndex) o.itemReverseZIndex = true;
  if ("strokesIncludedInLayout" in node && node.strokesIncludedInLayout) o.strokesIncludedInLayout = true;
  return o;
}

function mixedOr(v) {
  return v === figma.mixed ? "mixed" : v;
}

function textObj(node) {
  const o = {
    characters: node.characters,
    fontSize: mixedOr(node.fontSize),
    fontName: mixedOr(node.fontName),
    fontWeight: mixedOr(node.fontWeight),
    letterSpacing: mixedOr(node.letterSpacing),
    lineHeight: mixedOr(node.lineHeight),
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    textCase: mixedOr(node.textCase),
    textDecoration: mixedOr(node.textDecoration),
  };
  if ("paragraphSpacing" in node && node.paragraphSpacing) o.paragraphSpacing = node.paragraphSpacing;
  if ("paragraphIndent" in node && node.paragraphIndent) o.paragraphIndent = node.paragraphIndent;
  if ("textAutoResize" in node) o.textAutoResize = node.textAutoResize;
  if ("textTruncation" in node && node.textTruncation && node.textTruncation !== "DISABLED") o.textTruncation = node.textTruncation;
  if ("maxLines" in node && node.maxLines != null) o.maxLines = node.maxLines;
  if ("leadingTrim" in node && node.leadingTrim && node.leadingTrim !== "NONE") o.leadingTrim = node.leadingTrim;
  if ("hyperlink" in node && node.hyperlink && node.hyperlink !== figma.mixed) o.hyperlink = node.hyperlink;

  // When the text mixes styles, break it into per-range segments so the detail
  // isn't lost behind "mixed". getStyledTextSegments is synchronous.
  const isMixed =
    node.fontSize === figma.mixed ||
    node.fontName === figma.mixed ||
    node.fontWeight === figma.mixed ||
    node.fills === figma.mixed ||
    node.textDecoration === figma.mixed ||
    node.letterSpacing === figma.mixed ||
    node.lineHeight === figma.mixed;
  if (isMixed && typeof node.getStyledTextSegments === "function") {
    try {
      const segs = node.getStyledTextSegments([
        "fontSize",
        "fontName",
        "fontWeight",
        "fills",
        "textDecoration",
        "textCase",
        "letterSpacing",
        "lineHeight",
        "hyperlink",
      ]);
      o.segments = segs.map((s) => {
        const so = {
          start: s.start,
          end: s.end,
          characters: node.characters.slice(s.start, s.end),
          fontSize: s.fontSize,
          fontName: s.fontName,
          fontWeight: s.fontWeight,
          textDecoration: s.textDecoration,
          textCase: s.textCase,
          letterSpacing: s.letterSpacing,
          lineHeight: s.lineHeight,
        };
        if (s.fills) so.fills = paintsToArr(s.fills);
        if (s.hyperlink) so.hyperlink = s.hyperlink;
        return so;
      });
    } catch (e) {
      // ignore
    }
  }
  return o;
}

// Time-box an async lookup so a hanging Figma API call degrades gracefully
// instead of stalling the whole serialization. Under documentAccess:
// "dynamic-page", getVariableByIdAsync / getMainComponentAsync for library-backed
// nodes can take many seconds (or effectively hang), which previously made
// get_design_context time out on real design-system files.
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((res) => setTimeout(() => res(fallback), ms))]);
}

// id -> Variable map, built ONCE per read request from a single
// getLocalVariablesAsync() call, instead of one getVariableByIdAsync per node
// (which is slow and can hang). Library/remote variables aren't local, so their
// names won't resolve from here — callers still return the raw id for those.
let _localVarMapPromise = null;
function resetVarCache() {
  _localVarMapPromise = null;
}
function localVarMap() {
  if (!_localVarMapPromise) {
    _localVarMapPromise = (async () => {
      const map = Object.create(null);
      try {
        const vars = await withTimeout(figma.variables.getLocalVariablesAsync(), 8000, []);
        for (const v of vars) map[v.id] = v;
      } catch (e) {
        // ignore
      }
      return map;
    })();
  }
  return _localVarMapPromise;
}

// id -> { name, type } map of local paint/text/effect/grid styles, built once
// per request (same approach as localVarMap — avoids a hang-prone
// getStyleByIdAsync per node).
let _localStyleMapPromise = null;
function resetStyleCache() {
  _localStyleMapPromise = null;
}
function localStyleMap() {
  if (!_localStyleMapPromise) {
    _localStyleMapPromise = (async () => {
      const map = Object.create(null);
      const loaders = [
        ["PAINT", figma.getLocalPaintStylesAsync],
        ["TEXT", figma.getLocalTextStylesAsync],
        ["EFFECT", figma.getLocalEffectStylesAsync],
        ["GRID", figma.getLocalGridStylesAsync],
      ];
      for (const pair of loaders) {
        try {
          const styles = await withTimeout(pair[1].call(figma), 4000, []);
          for (const s of styles) map[s.id] = { name: s.name, type: pair[0] };
        } catch (e) {
          // ignore
        }
      }
      return map;
    })();
  }
  return _localStyleMapPromise;
}

// Resolve a style id to { id, name } (name when it's a local style).
async function styleRef(id) {
  if (!id || id === figma.mixed) return undefined;
  const map = await localStyleMap();
  const s = map[id];
  return s ? { id: id, name: s.name } : { id: id };
}

// Shared-style references applied to a node (fill/stroke/effect/grid/text).
async function stylesObj(node) {
  const out = {};
  const pairs = [
    ["fillStyleId", "fill"],
    ["strokeStyleId", "stroke"],
    ["effectStyleId", "effect"],
    ["gridStyleId", "grid"],
  ];
  for (const p of pairs) {
    if (p[0] in node && node[p[0]] && node[p[0]] !== figma.mixed) {
      const r = await styleRef(node[p[0]]);
      if (r) out[p[1]] = r;
    }
  }
  if (node.type === "TEXT" && "textStyleId" in node && node.textStyleId && node.textStyleId !== figma.mixed) {
    const r = await styleRef(node.textStyleId);
    if (r) out.text = r;
  }
  return Object.keys(out).length ? out : undefined;
}

// Layout (design) grids on a frame.
function gridsToArr(grids) {
  return grids.map((g) => {
    const o = { pattern: g.pattern, visible: g.visible !== false };
    if (typeof g.sectionSize === "number") o.sectionSize = g.sectionSize;
    if (typeof g.gutterSize === "number") o.gutterSize = g.gutterSize;
    if (typeof g.count === "number") o.count = g.count;
    if (g.alignment) o.alignment = g.alignment;
    if (typeof g.offset === "number") o.offset = g.offset;
    if (g.color) o.color = rgbToHex(g.color);
    return o;
  });
}

async function componentObj(node) {
  if (node.type === "INSTANCE") {
    let main = null;
    try {
      main = await withTimeout(node.getMainComponentAsync(), 2500, null);
    } catch (e) {
      // ignore
    }
    // Description / documentation links live on the component set when the main
    // component is one of its variants.
    let meta = main;
    if (main && main.parent && main.parent.type === "COMPONENT_SET") meta = main.parent;
    return {
      mainComponentName: main ? main.name : undefined,
      mainComponentKey: main ? main.key : undefined,
      mainComponentId: main ? main.id : undefined,
      description: meta ? meta.description || undefined : undefined,
      documentationLinks: meta ? docLinks(meta) : undefined,
      properties: node.componentProperties ? serializeComponentProps(node.componentProperties) : undefined,
      overrides:
        Array.isArray(node.overrides) && node.overrides.length
          ? node.overrides.map((ov) => ({ id: ov.id, fields: ov.overriddenFields }))
          : undefined,
    };
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    return { key: node.key, description: node.description || undefined, documentationLinks: docLinks(node) };
  }
  return undefined;
}

// Component documentation links (the "Documentation" URLs set in Figma) as a
// plain string array.
function docLinks(node) {
  try {
    const dl = node.documentationLinks;
    if (Array.isArray(dl) && dl.length) {
      const uris = dl.map((d) => d && d.uri).filter(Boolean);
      if (uris.length) return uris;
    }
  } catch (e) {
    // ignore
  }
  return undefined;
}

function serializeComponentProps(props) {
  const o = {};
  for (const k of Object.keys(props)) {
    const p = props[k];
    o[k] = p && typeof p === "object" && "value" in p ? p.value : p;
  }
  return o;
}

async function boundVarsObj(node) {
  const bv = node.boundVariables;
  if (!bv || typeof bv !== "object") return undefined;
  const map = await localVarMap(); // one bulk lookup, cached for the whole request
  const out = {};
  for (const prop of Object.keys(bv)) {
    const entry = bv[prop];
    const arr = Array.isArray(entry) ? entry : [entry];
    const refs = [];
    for (const a of arr) {
      if (a && a.id) {
        const v = map[a.id];
        // Always include the raw id (raw data); add the name when it's a local
        // variable. Remote/library bindings keep just the id.
        refs.push(v ? { id: a.id, name: v.name } : { id: a.id });
      }
    }
    if (refs.length) out[prop] = refs.length === 1 ? refs[0] : refs;
  }
  return Object.keys(out).length ? out : undefined;
}
