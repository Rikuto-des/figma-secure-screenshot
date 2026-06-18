# AGENTS.md — Figma design work via yasuda-figma-mcp

> If you already have an `AGENTS.md`, merge the section below into it.

## Working from a Figma design (yfigma_* MCP tools)

The `yfigma_*` tools are **read-only** and read the user's **currently open Figma file
locally** (no cloud upload). When a task involves a Figma design, use them instead of
guessing spacing, colors, or typography.

**When to use:** the user shares a figma.com URL, references "this frame/screen/component",
or asks to implement / match a design or extract its tokens.

**Targeting a node**
- Pass `url` (a figma.com link with `?node-id=…`) or `nodeId` (e.g. `"12:345"`).
- Pass neither to use the user's **current selection**.
- The node must be in the file the user **currently has open** (the plugin only sees the open
  document). On "Node not found", ask them to open that file / select the node — never invent values.

**Workflow (design → code)**
1. `yfigma_get_screenshot` — see the design (visual ground truth).
2. `yfigma_get_metadata` — cheap node tree; understand structure, get child node ids (`depth`).
3. `yfigma_get_design_context` — structured layout/styles/typography/variables. **Raw data — you write the code.**
4. `yfigma_get_variable_defs` — design tokens (per-mode values). **Map fills/spacing to token names; don't hardcode.**
5. `yfigma_search_design_system` / `yfigma_get_libraries` — find existing components/styles/variables to **reuse**.
6. Re-run `yfigma_get_screenshot` and compare against your implementation.

**Translating `design_context`**
- `layout HORIZONTAL/VERTICAL` → flex/stack; `itemSpacing` → gap; `padding` → padding.
- `fills` → color token if `boundVariables` has one, else the hex.
- `text` → font family/size/weight/line-height/alignment; `cornerRadius`/`effects`/`strokes` → radius/shadow/border.
- `component` instances → reuse the mapped code component (`componentProperties` → props).
- `"mixed"` means the property varies across children — inspect them or ask which variant.

**Do:** search the design system first and reuse; verify with a screenshot; ask when a target isn't found.
**Don't:** expect finished code (it's raw data); hardcode when a token exists; read files that aren't open; try to modify Figma (read-only).

**The 9 tools:** `yfigma_get_screenshot` (`scale`,`format`,`saveToFile`), `yfigma_get_metadata`
(`depth`), `yfigma_get_design_context` (`depth`), `yfigma_get_variable_defs`
(`scope: target|all`), `yfigma_search_design_system` (`query`,`kinds`,`allPages`,`limit`),
`yfigma_get_libraries`, `yfigma_get_figjam`, `yfigma_get_document_info`, `yfigma_whoami`.
Targeting via `url`/`nodeId` or current selection.
