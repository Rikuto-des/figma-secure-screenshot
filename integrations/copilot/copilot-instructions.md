<!--
Copy to .github/copilot-instructions.md at your repo root.
If you already have one, paste the "Working from Figma designs" section into it.
GitHub Copilot reads this file automatically in agent mode.
-->

# Copilot instructions

## Working from Figma designs (yasuda-figma-mcp)

The `yfigma_*` MCP tools are **read-only** and read the user's **currently open Figma file
locally** (no cloud upload, no public S3). When a task involves a Figma design, use these
tools instead of guessing spacing, colors, or typography.

**Use them when** the user shares a figma.com URL, references "this frame / screen /
component", or asks to implement, match, or extract tokens from a design.

### Targeting a node
- Pass `url` (a figma.com link containing `?node-id=…`) or `nodeId` (e.g. `"12:345"`).
- Pass neither to act on the user's **current selection** in Figma.
- The node must be in the file the user **currently has open** — the plugin only sees the open
  document. If a tool returns "Node not found", ask the user to open that file or select the
  node. Never fabricate pixel values or colors.

### Workflow: design → code
1. **`yfigma_get_screenshot`** — see the design (visual ground truth).
2. **`yfigma_get_metadata`** — cheap node tree; understand structure and collect child node ids (`depth`).
3. **`yfigma_get_design_context`** — structured layout / styles / typography / variables. This is **raw data — you write the code.**
4. **`yfigma_get_variable_defs`** — design tokens with per-mode values. **Map fills and spacing to these token names; don't hardcode** hex/px.
5. **`yfigma_search_design_system`** / **`yfigma_get_libraries`** — find existing components/styles/variables and **reuse** them.
6. After implementing, call **`yfigma_get_screenshot`** again and compare to your output.

### Translating `design_context`
- `layout HORIZONTAL/VERTICAL` → flexbox / stack; `itemSpacing` → `gap`; `padding{…}` → padding.
- `fills` (SOLID hex) → a color **token** if `boundVariables` names one, otherwise the hex.
- `text` → font family / size / weight / line-height / letter-spacing / alignment.
- `cornerRadius`, `effects` (shadows/blur), `strokes` → border-radius / box-shadow / border.
- `component` instances → reuse the mapped code component; `componentProperties` → props.
- A `"mixed"` value means the property varies across children — inspect them or ask the user.

### Do / Don't
- **Do:** search the design system first and reuse components, variables, and tokens; verify the result with a screenshot; ask the user to open/select the right node when a target isn't found.
- **Don't:** expect finished code from Figma (`design_context` is raw data); hardcode a value when a variable/token exists; try to read a file the user doesn't have open; attempt to modify Figma — these tools are read-only.

### The 9 tools
`yfigma_get_screenshot` (`url`/`nodeId`, `scale`, `format`, `saveToFile`) ·
`yfigma_get_metadata` (`depth`) · `yfigma_get_design_context` (`depth`) ·
`yfigma_get_variable_defs` (`scope: target|all`) ·
`yfigma_search_design_system` (`query`, `kinds`, `allPages`, `limit`) ·
`yfigma_get_libraries` · `yfigma_get_figjam` · `yfigma_get_document_info` · `yfigma_whoami`.
