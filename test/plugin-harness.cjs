/* Mock-Figma harness: runs plugin/code.js's write logic in Node to verify the
 * orchestration (build / reconcile / swap / validateOnly). NOT a render test. */
const fs = require("fs");
const vm = require("vm");

let idSeq = 0;
const registry = new Map();
const nid = () => "n" + ++idSeq;

function container(node) {
  node.children = [];
  node.appendChild = (c) => {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    c.parent = node;
    node.children.push(c);
  };
  node.insertChild = (i, c) => {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    c.parent = node;
    node.children.splice(i, 0, c);
  };
  return node;
}
function removable(node) {
  node.remove = () => {
    if (node.parent) node.parent.children = node.parent.children.filter((x) => x !== node);
    node.removed = true;
  };
  return node;
}

function makeFrame(name) {
  const f = removable(container({
    id: nid(), type: "FRAME", name: name || "Frame", parent: null,
    layoutMode: "NONE", itemSpacing: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN",
    layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG",
    width: 100, height: 100, x: 0, y: 0, fills: [],
    boundVars: {},
    resize(w, h) { this.width = w; this.height = h; },
    setBoundVariable(field, v) { this.boundVars[field] = v.id; },
  }));
  registry.set(f.id, f);
  return f;
}
function makeText(name) {
  const t = removable({
    id: nid(), type: "TEXT", name: name || "Text", parent: null,
    characters: "", fontName: { family: "Inter", style: "Regular" }, fontSize: 12, fills: [],
    getRangeAllFontNames() { return [this.fontName]; },
    setTextStyleIdAsync() { this.styleId = arguments[0]; return Promise.resolve(); },
  });
  registry.set(t.id, t);
  return t;
}
function makeInstance(main) {
  const inst = removable(container({
    id: nid(), type: "INSTANCE", name: "Instance", parent: null, _main: main, _props: {},
    getMainComponentAsync() { return Promise.resolve(this._main); },
    setProperties(map) { Object.assign(this._props, map); this._setCalled = true; },
    swapComponent(comp) { this._main = comp; this._swapped = true; },
    findAllWithCriteria() { return this.children.filter((c) => c.type === "TEXT"); },
    findAll(fn) { return this.children.filter(fn); },
  }));
  registry.set(inst.id, inst);
  return inst;
}
function makeComponent(name, defs, parent) {
  const c = {
    id: nid(), type: "COMPONENT", name, key: "key_" + name, remote: false, parent: parent || null,
    componentPropertyDefinitions: defs || {},
    createInstance() { return makeInstance(this); },
  };
  registry.set(c.id, c);
  return c;
}
function makeComponentSet(name, defs, variantNames) {
  const set = container({ id: nid(), type: "COMPONENT_SET", name, key: "key_" + name, remote: false, parent: null, componentPropertyDefinitions: defs });
  for (const vn of variantNames) {
    const v = makeComponent(name + "/" + vn, defs, set);
    set.children.push(v);
  }
  set.defaultVariant = set.children[0];
  registry.set(set.id, set);
  return set;
}

// ---- document --------------------------------------------------------------
const currentPage = container({ id: "page1", type: "PAGE", name: "Page 1", selection: [] });
const Button = makeComponentSet("Button", {
  Variant: { type: "VARIANT", defaultValue: "Primary", variantOptions: ["Primary", "Secondary"] },
  "Label#1:0": { type: "TEXT", defaultValue: "Button" },
}, ["Primary", "Secondary"]);
const Input = makeComponent("Input", { "Label#2:0": { type: "TEXT", defaultValue: "Input" } });
const spacingVar = { id: "VariableID:1:5", name: "spacing/md", resolvedType: "FLOAT" };
const colorVar = { id: "VariableID:1:9", name: "color/bg", resolvedType: "COLOR" };
const headingStyle = { id: "S:heading", type: "TEXT", name: "Heading", fontName: { family: "Inter", style: "Bold" } };

const figma = {
  editorType: "figma",
  mixed: Symbol("mixed"),
  root: { id: "root", name: "Doc", children: [currentPage] },
  currentPage,
  viewport: { center: { x: 500, y: 500 }, scrollAndZoomIntoView() {} },
  createFrame() { const f = makeFrame(); currentPage.appendChild(f); return f; },
  createText() { const t = makeText(); currentPage.appendChild(t); return t; },
  getNodeByIdAsync(id) { return Promise.resolve(registry.get(id) || null); },
  loadFontAsync() { return Promise.resolve(); },
  getStyleByIdAsync(id) { return Promise.resolve(id === headingStyle.id ? headingStyle : null); },
  variables: {
    getVariableByIdAsync(id) { return Promise.resolve(id === spacingVar.id ? spacingVar : id === colorVar.id ? colorVar : null); },
    setBoundVariableForPaint(paint, field, v) { return Object.assign({}, paint, { boundVariables: { [field]: v.id } }); },
  },
  showUI() {}, ui: { postMessage() {}, onmessage: null },
  clientStorage: { getAsync() { return Promise.resolve(null); }, setAsync() { return Promise.resolve(); } },
  base64Encode() { return ""; },
  currentUser: null, teamLibrary: {},
};

// ---- load plugin -----------------------------------------------------------
const code = fs.readFileSync("plugin/code.js", "utf8");
const sandbox = { figma, __html__: "", console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const apply = (params) => sandbox.handleRequest("apply_ui_spec", params);

// ---- assertions ------------------------------------------------------------
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); } }

(async () => {
  // 1. create: frame (token gap/padding) + heading text + 2 instances
  currentPage.selection = [];
  let r = await apply({ version: 1, root: {
    type: "frame", name: "Login", layout: "VERTICAL",
    gap: { var: spacingVar.id }, padding: { var: spacingVar.id }, counterAxisAlign: "STRETCH", width: 360,
    children: [
      { type: "text", characters: "Sign in", textStyleId: headingStyle.id },
      { type: "instance", componentId: Input.id, props: { Label: "Email" } },
      { type: "instance", componentId: Button.id, props: { Variant: "Secondary", Label: "Go" } },
    ],
  }});
  ok("create valid", r.valid, JSON.stringify(r.errors));
  const root = registry.get(r.root.id);
  ok("create root is FRAME", root.type === "FRAME");
  ok("create layout applied", root.layoutMode === "VERTICAL");
  ok("create gap bound to var", root.boundVars.itemSpacing === spacingVar.id);
  ok("create width fixed 360", root.layoutSizingHorizontal === "FIXED" && root.width === 360);
  ok("create 3 children", root.children.length === 3);
  ok("create heading text", root.children[0].type === "TEXT" && root.children[0].characters === "Sign in");
  ok("create instance props set", root.children[2]._props.Variant === "Secondary" && root.children[2]._props["Label#1:0"] === "Go");

  // 2. validateOnly: bad component id
  r = await apply({ version: 1, validateOnly: true, root: { type: "frame", layout: "VERTICAL", children: [{ type: "instance", componentId: "nope" }] } });
  ok("validateOnly catches bad componentId", !r.valid && /not found/.test(JSON.stringify(r.errors)));

  // 3. validateOnly: bad variant value
  r = await apply({ version: 1, validateOnly: true, root: { type: "instance", componentId: Button.id, props: { Variant: "Nope" } } });
  ok("validateOnly catches bad variant", !r.valid && /not a valid value/.test(JSON.stringify(r.errors)));

  // 4. update-selection: change padding, OMIT children -> children preserved (the fix)
  const fr = makeFrame("Card"); fr.layoutMode = "VERTICAL"; currentPage.appendChild(fr);
  const k1 = makeInstance(Input); const k2 = makeText("note"); fr.appendChild(k1); fr.appendChild(k2);
  currentPage.selection = [fr];
  r = await apply({ version: 1, target: { mode: "update-selection" }, root: { type: "frame", layout: "VERTICAL", padding: 24 } });
  ok("update omit-children preserves kids", r.valid && fr.children.length === 2, "len=" + fr.children.length);
  ok("update applied padding", fr.paddingTop === 24);

  // 5. update-selection: name-based child reconcile + reorder
  const fr2 = makeFrame("List"); fr2.layoutMode = "VERTICAL"; currentPage.appendChild(fr2);
  const a = makeInstance(Input); a.name = "A"; const b = makeInstance(Input); b.name = "B";
  fr2.appendChild(a); fr2.appendChild(b);
  currentPage.selection = [fr2];
  r = await apply({ version: 1, target: { mode: "update-selection" }, root: {
    type: "frame", layout: "VERTICAL", children: [
      { type: "instance", componentId: Input.id, name: "B" },   // reused, moved to front
      { type: "instance", componentId: Input.id, name: "A" },   // reused, moved to back
      { type: "instance", componentId: Input.id, name: "C" },   // new
    ],
  }});
  ok("reconcile valid", r.valid, JSON.stringify(r.errors));
  ok("reconcile reuses B at index0 (same node id)", fr2.children[0].id === b.id);
  ok("reconcile reuses A at index1 (same node id)", fr2.children[1].id === a.id);
  ok("reconcile adds C at index2 (new)", fr2.children[2].id !== a.id && fr2.children[2].id !== b.id && fr2.children.length === 3);

  // 6. update-selection: component swap (Button instance -> Input)
  const inst = makeInstance(Button.defaultVariant); currentPage.appendChild(inst);
  currentPage.selection = [inst];
  r = await apply({ version: 1, target: { mode: "update-selection" }, root: { type: "instance", componentId: Input.id, props: { Label: "Swapped" } } });
  ok("swap valid", r.valid, JSON.stringify(r.errors));
  ok("swap changed main component to Input", inst._swapped === true && inst._main.id === Input.id);
  ok("swap applied props after swap", inst._props["Label#2:0"] === "Swapped");

  // 7. update-selection: SAME family (Button variant) -> no swap, variant via props
  const inst2 = makeInstance(Button.defaultVariant); currentPage.appendChild(inst2);
  currentPage.selection = [inst2];
  r = await apply({ version: 1, target: { mode: "update-selection" }, root: { type: "instance", componentId: Button.id, props: { Variant: "Secondary" } } });
  ok("same-family no swap", r.valid && !inst2._swapped && inst2._props.Variant === "Secondary");

  // 8. into-selection: append into selected auto-layout frame
  const host = makeFrame("Host"); host.layoutMode = "VERTICAL"; currentPage.appendChild(host);
  currentPage.selection = [host];
  const before = host.children.length;
  r = await apply({ version: 1, target: { mode: "into-selection" }, root: { type: "instance", componentId: Input.id } });
  ok("into-selection appended one child", r.valid && host.children.length === before + 1);

  // 9. into-selection error: selection not an auto-layout frame
  currentPage.selection = [makeText("plain")];
  r = await apply({ version: 1, target: { mode: "into-selection" }, root: { type: "instance", componentId: Input.id } });
  ok("into-selection rejects non-AL-frame", !r.valid && /auto-layout frame/.test(JSON.stringify(r.errors)));

  // 10. design mode guard
  figma.editorType = "dev";
  let threw = false;
  try { await apply({ version: 1, root: { type: "frame", layout: "VERTICAL" } }); } catch (e) { threw = /Design mode/.test(e.message); }
  ok("dev mode rejected", threw);
  figma.editorType = "figma";

  console.log(`\nplugin harness: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
