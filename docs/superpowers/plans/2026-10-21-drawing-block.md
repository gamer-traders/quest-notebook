# Drawing Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a OneNote-style drawing block: pressure-sensitive ink with pens and colours, a stroke eraser, undo, a canvas that grows downward, full screen, saved as vector strokes in the page JSON plus an SVG picture copy beside the page.

**Architecture:**
- **A fourth item block:** the drawing is an item block like chart, plan and prediction. Its data lives in the notebook's `items`, keyed by block id.
- **Pure helpers:** strokes, outlines, hit testing, growth and SVG export live in `src/renderer/src/drawing/`.
- **The drawing UI** is an SVG canvas driven by Pointer Events.
- **Picture copies:** the renderer makes each page's SVG copies and sends them with the page save. Main writes them into the page folder and removes stale ones.

**Tech Stack:** perfect-freehand 1.2 (MIT), React 19, BlockNote 0.56 custom blocks, Pointer Events (pressure, coalesced events), and the HTML Fullscreen API.

**Spec:** `docs/superpowers/specs/2026-10-21-drawing-block-design.md`

## Global Constraints

- **Coordinates:** a drawing is 1000 units wide, and `height` is in the same units.
- **Stored points:** each stroke's `points` is a string of `x,y,p` triples separated by spaces, with x and y to 1 decimal place and p to 2.
- **Tools:** `pen`, `pencil`, `marker`, `highlighter` (and `eraser`, which isn't stored).
- **Colours:** `ink`, `yellow`, `blue`, `green`, `red`, `purple`, `gray`.
- **Backgrounds:** `blank`, `grid`, `lines`.
- **Sizes**, as `[small, medium, large]`:
  - pen `[1.5, 3, 5]`
  - pencil `[1, 2, 3.5]`
  - marker `[6, 10, 16]`
  - highlighter `[14, 22, 32]`
  - eraser radius `[8, 16, 32]`
- **Growth:** a new drawing is 400 units high. It grows by 300 when a finished stroke comes within 80 units of the bottom, and "More space" adds 300.
- **Picture copies** are named `drawing-<id>.svg`. Main accepts only names matching `^drawing-[A-Za-z0-9_-]{1,64}\.svg$`.
- **Drawing input** never reaches the page editor: the block frame stops propagation, as it does for charts.
- **Tests:** `npm test`, `npm run typecheck` and `npm run build` stay green, and pure logic is written test-first.

## Review Focus

1. **A pen stroke that leaves the canvas mid-draw:** pointer capture keeps the stroke going, and it ends cleanly on pointerup or pointercancel. Test in Task 4 (live check).
2. **A drawing with no strokes, and one whose `points` string is malformed or written by an AI** with extra spaces or missing pressure: it loads, skips the bad points, and never crashes the page. Test in Task 1.
3. **Deleting the drawing block:** the next save removes its SVG copy, and an empty page folder goes away. Test in Task 3.
4. **Drawing ids from files that aren't safe file names:** no picture copy is written outside the page folder. Test in Task 3.
5. **Quitting right after the last stroke:** the stroke is in the store when the stroke ends, before any debounce. Test in Task 4.

---

### Task 1: Drawing model, strokes and picture copy (pure)

**Files:**
- Create:
  - `src/renderer/src/drawing/model.ts`
  - `src/renderer/src/drawing/strokes.ts` and `strokes.test.ts`
  - `src/renderer/src/drawing/svg.ts` and `svg.test.ts`
- Modify: `package.json`, adding the dependency `perfect-freehand@^1.2.3`

**Interfaces:**
- Produces, in `model.ts`:
  - `type PenTool = 'pen' | 'pencil' | 'marker' | 'highlighter'`
  - `type Tool = PenTool | 'eraser'`
  - `type InkColor = 'ink' | MarkColor`
  - `type Background = 'blank' | 'grid' | 'lines'`
  - `interface Stroke { id: string; tool: PenTool; color: InkColor; size: number; pressure: boolean; points: number[] }`, where `points` is flat `[x, y, p, …]`
  - `DRAWING_WIDTH = 1000`, `NEW_HEIGHT = 400`, `GROW_BY = 300`, `GROW_MARGIN = 80`
  - `SIZES: Record<Tool, [number, number, number]>`
  - `INK_COLORS: InkColor[]`
- Produces, in `strokes.ts`:
  - `encodePoints(points: number[]): string` and `decodePoints(text: string): number[]`. Decoding skips malformed triples and gives pressure 0.5 when it's missing.
  - `strokeOptions(stroke): StrokeOptions` for perfect-freehand, per tool:
    - `thinning`: pen 0.6, pencil 0.75, marker 0.1, highlighter 0
    - `smoothing` 0.5, `streamline` 0.45
    - `simulatePressure: !stroke.pressure`
  - `strokePath(stroke: Pick<Stroke, 'tool' | 'size' | 'pressure' | 'points'>, last?: boolean): string`, an SVG path `d` from perfect-freehand's outline
  - `strokesHit(strokes: Stroke[], x: number, y: number, radius: number): string[]`, the ids of strokes whose polyline comes within `radius + size / 2`
  - `grownHeight(height: number, strokeBottom: number): number`
- Produces, in `svg.ts`:
  - `drawingToSvg(d: { height: number; background: Background; strokes: Stroke[] }): string`, a standalone SVG 1000 wide, with `viewBox="0 0 1000 <height>"`, a white background, the grid or lines pattern, and highlighter paths first. Colours are hex values from `LIGHT_COLORS`.

- [ ] **Step 1: Failing tests**
  - Points round-trip: `encodePoints([1.234, 5.678, 0.456])` gives `'1.2,5.7,0.46'`.
  - `decodePoints(' 1,2,0.5  3,4 x,y,z 5,6,0.7 ')` gives `[1, 2, 0.5, 3, 4, 0.5, 5, 6, 0.7]`.
  - `strokePath` gives a non-empty `d` starting with `M`, and the empty string for no points.
  - A stroke drawn with pressure 1 has a wider outline than the same stroke at pressure 0.1 (compare outline bounding-box heights for a horizontal line).
  - `strokesHit` finds a stroke whose segment passes 3 units from the point with radius 2 and size 4, and misses it at 10 units.
  - `grownHeight(400, 300)` is 400, `grownHeight(400, 350)` is 700, and `grownHeight(400, 900)` is 1200, growing until the stroke is clear of the margin.
  - The SVG starts with `<svg`, has `viewBox="0 0 1000 420"`, has one `<path` per stroke, puts the highlighter path before the pen path, and colours ink `#17202a`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: drawing strokes, outlines and SVG export`

### Task 2: Drawing as an item: store, file format, README

**Files:**
- Modify:
  - `src/renderer/src/types.ts`: `DrawingCell { id; type: 'drawing'; height: number; background: Background; strokes: Stroke[] }`, added to `ItemData`
  - `src/renderer/src/page/blockTypes.ts`: `ITEM_BLOCK_TYPES` gains `'drawing'`, and `ITEM_BLOCK_FOR` gains `drawing: 'drawing'`
  - `src/renderer/src/lib/cells.ts`: `newItem` accepts `'drawing'`, and `itemText` gives `''` for a drawing
  - `src/renderer/src/page/blocks.ts`: `itemsUnderChart` keeps only plans and calls
  - `src/shared/pageFile.ts`: `FileDrawing`, added to `FileBlock`
  - `src/renderer/src/files/convert.ts`: drawings to and from files
  - `src/shared/readme.ts`: a "Drawings" section
- Test: `src/renderer/src/files/convert.test.ts`

- [ ] **Step 1: Failing tests**
  - A drawing round-trips: the file block equals `{ type: 'drawing', id, height: 420, background: 'grid', strokes: [{ tool: 'pen', color: 'ink', size: 3, pressure: true, points: '1.5,2,0.4 3,4,0.6' }] }`, and loading it gives the same cell, with stroke ids blanked.
  - A file drawing with a bad `tool`, `color` or `background`, or missing `height`, loads with `pen`, `ink`, `blank` and `400`.
  - A stroke with no valid points is dropped.
  - The README contains `## Drawings` and `drawing-<id>.svg`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Also fix every exhaustive switch the compiler flags.
- [ ] **Step 4: Run.** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: drawings are page items with a readable file format`

### Task 3: Picture copies written beside the page

**Files:**
- Modify:
  - `src/shared/ipc.ts`: `PageSave.sidecars: Record<string, string>`, file name to text
  - `src/renderer/src/workspace/sync.ts`: each save carries `sidecars` for the page's drawings, made with `drawingToSvg` and cached per strokes array
  - `src/main/workspace/apply.ts`: after a page is written, reconcile `drawing-*.svg` in its folder
- Test: `src/main/workspace/apply.test.ts` and `src/renderer/src/workspace/sync.test.ts`

- [ ] **Step 1: Failing tests**
  - **apply:**
    - A save with `sidecars: { 'drawing-d1.svg': '<svg/>' }` creates `Markets/Page/drawing-d1.svg`.
    - A second save with the same text leaves the mtime unchanged.
    - A save with `sidecars: {}` removes it, and an empty `Markets/Page/` is removed too.
    - A name like `../x.svg` or `drawing-a/b.svg` is skipped: nothing is written outside the folder, and the result reports an error.
    - Sub-pages in the folder are left alone.
  - **sync:** a page with a drawing block saves with `sidecars` holding `drawing-<id>.svg` that starts with `<svg`. A page without drawings saves `sidecars: {}`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: drawings get an SVG copy beside their page`

### Task 4: The drawing block UI

**Files:**
- Create:
  - `src/renderer/src/drawing/DrawingCanvas.tsx`: pointer input, live stroke, eraser, undo and redo, growth
  - `src/renderer/src/drawing/DrawingToolbar.tsx`
  - `src/renderer/src/drawing/DrawingView.tsx`: the block view, with the canvas, the toolbar, "More space" and full screen
  - `src/renderer/src/drawing/penSettings.ts` and `penSettings.test.ts`: the remembered tool, size, colour and background, kept in localStorage with defaults
  - `src/renderer/src/drawing/drawing.css`
- Modify:
  - `src/renderer/src/editor/ItemBlocks.tsx`: `DrawingBlock`
  - `src/renderer/src/editor/schema.ts`
  - `src/renderer/src/editor/slashItems.ts`: "Drawing", with aliases `draw`, `sketch`, `ink`, `pen` and `handwriting`
  - `src/renderer/src/components/Sidebar.tsx`: `BLOCK_LABEL.drawing = 'Drawing'`

**Behaviour:**
- **Starting a stroke:** on `pointerdown` (primary button, pen or mouse or touch), call `setPointerCapture`.
  - A pen whose `buttons & 32` is set, or whose `button === 5`, uses the eraser.
- **While drawing:** on `pointermove`, take `getCoalescedEvents()`, convert to drawing units (`x / scale`, where `scale = canvasWidth / 1000`), and push `x, y, pressure`. Pen strokes use the event's pressure. Other input uses 0.5 with `pressure: false`. The live path is redrawn in `requestAnimationFrame`.
- **Ending a stroke:** on `pointerup` or `pointercancel`, commit with `updateItem(notebookId, id, { strokes: [...], height: grownHeight(...) })` straight away, and push to the undo stack.
- **Eraser:** on down and move, it removes the strokes `strokesHit` finds, and the removals since `pointerdown` count as one undo step.
- **Undo and redo:** Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z while the pointer is over the drawing or it has focus. The drawing's root is focusable, with `tabIndex=0`.
- **Full screen:** a portal holds the same canvas and toolbar and calls `requestFullscreen()`. Leaving full screen (Escape) or pressing "Done" closes it.
- **Touch:** `touch-action: none` on the canvas.

- [ ] **Step 1: Failing test:** `penSettings` returns the defaults (`pen`, medium, `ink`, `blank`) when storage is empty or broken, and saves and reads back a choice.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the components and styles.
- [ ] **Step 4: Run.** `npm test && npm run typecheck && npm run build`. Expected: PASS.
- [ ] **Step 5: Live check** over CDP in the built app:
  1. Insert a drawing with `/drawing`.
  2. Draw two strokes with `Input.dispatchMouseEvent`, using `pointerType: 'pen'` and `force` of 0.2 and then 0.9 on similar strokes, and screenshot: the second is thicker.
  3. Erase one stroke.
  4. Undo.
  5. Use full screen.
  6. Check the page JSON and the SVG file.
- [ ] **Step 6: Commit:** `feat: drawing block with pens, eraser, undo and full screen`
