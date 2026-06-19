---
mode: agent
description: Implement from a Figma design, or generate UI into Figma, using the yasuda-figma-mcp (yfigma_*) tools — local render/apply, no public S3.
---

Work from the Figma design I'm referring to, using the **read-only `yfigma_*` MCP tools**
(they read my currently-open Figma file locally). Don't guess spacing, colors, or typography.

**Target:** if I gave a figma.com URL or a `nodeId`, use it; otherwise use my **current
selection** in Figma. The node must be in the file I have open — if a tool returns
"Node not found", ask me to open that file or select the node. Never fabricate values.

**Do this:**
1. `yfigma_get_screenshot` — see the design (visual ground truth).
2. `yfigma_get_metadata` — understand the structure and get child node ids (`depth` to go deeper).
3. `yfigma_get_design_context` — the structured truth: auto-layout, padding/gap, fills,
   strokes, effects, corner radius, typography, component info, and bound variables.
   **This is raw data — you write the code.**
4. `yfigma_get_variable_defs` — design tokens (per-mode values). **Map fills and spacing to
   these token names; don't hardcode** hex/px.
5. `yfigma_search_design_system` / `yfigma_get_libraries` — find existing components, styles,
   and variables and **reuse** them instead of reinventing.
6. After implementing, call `yfigma_get_screenshot` again and compare to your output; iterate
   until it matches.

**Map `design_context` → code:** `layout HORIZONTAL/VERTICAL` → flex/stack; `itemSpacing` →
`gap`; `padding{…}` → padding; `fills` → a color **token** if `boundVariables` names one, else
the hex; `text` → font family / size / weight / line-height / letter-spacing / alignment;
`cornerRadius` / `effects` / `strokes` → border-radius / box-shadow / border; `component`
instances → the mapped code component (`componentProperties` → props). A `"mixed"` value means
the property varies across children — inspect them or ask me.

## Generating UI INTO Figma (code → design)

You can also **build a screen in my open Figma file** from my existing design system.
The model sends declarative **data** (a UI spec) — never code — and the plugin applies it.
Requires Figma **Design mode** (not Dev Mode). Build only from **existing components** and
**auto-layout** — never raw rectangles or absolute coordinates.

**Loop:**
1. **Observe** — `yfigma_list_component_sets` (real `componentId`s, exact prop keys, variant
   options) and `yfigma_get_variable_defs` (token variable ids). **Use these real ids — never
   invent a `componentId` or variable id.** If a result has `truncated: true`, narrow with `query`.
2. **Plan** — write a UI spec (schema: [`docs/UI_SPEC.ja.md`](../../docs/UI_SPEC.ja.md)). One
   `root` node, usually a `frame` (`layout` VERTICAL/HORIZONTAL, `gap`, `padding`, `width`/`height`
   = `"HUG"`/`"FILL"`/number). Instances: `componentId` + `props` (friendly names). Prefer token
   refs `{ "var": "VariableID:…" }` for gap/padding/fill over literals.
3. **Validate** — call `yfigma_apply_ui_spec` with `validateOnly: true`. Fix **every** reported
   error before writing.
4. **Apply** — call `yfigma_apply_ui_spec` (omit `validateOnly`) to build it.
5. **Confirm** — `yfigma_get_screenshot` the returned root id, compare to intent, adjust and re-apply.

Not yet supported (the tool will say so — don't work around it): `INSTANCE_SWAP` props,
team-library components, in-place update (each apply creates a new screen).

Follow our existing code conventions and design-system naming. The `yfigma_get_*` / `yfigma_search_*`
/ `yfigma_list_*` tools are **read-only**; the only tool that changes Figma is **`yfigma_apply_ui_spec`**
(write), used as above.
