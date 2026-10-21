# Drawing block: design

Date: 21 Oct 2026
Status: building. The owner asked to implement straight away and adjust afterwards, so everything under "My calls" is mine.

## Intent

A **drawing** block for handwritten notes, like OneNote ink: sketching a chart shape, writing out a formula, or a quick note with a Wacom pen. It sits in a page like any other block, and it can be opened full screen to draw with more room.

## Decided with the owner

- **A new block type:** "drawing", with OneNote-like freehand ink.
- **Full screen:** the drawing can be opened full screen.
- **Pens and colours:** different pen types and colours.
- **Wacom pressure:** with a Wacom tablet, the pen's pressure sets the line's thickness.
- **Saved as vectors in the page JSON**, with a picture copy (SVG) written beside the page, so AI tools that look at images can read it.
- **The canvas is as wide as the page and grows downward**, not in every direction.

## Goals

1. **Inserting:** type `/drawing` to add a drawing block.
2. **Drawing in the page:** you draw right in the block in the page. A toolbar above the canvas has:
   - **Tools:** Pen, Pencil, Marker, Highlighter and Eraser.
   - **Three sizes per tool.**
   - **Seven colours:** ink (black in light theme, white in dark) and the app's six mark colours.
   - **Background:** blank, grid or lines.
   - **Undo and Redo.**
   - **Full screen.**
3. **Pressure:**
   - **Pen input:** the pen's pressure from the tablet sets each point's thickness.
   - **Mouse and trackpad input:** they have no pressure, so thickness follows drawing speed instead.
   - **Wacom eraser end:** flipping the pen to its eraser end erases.
4. **Highlighter:** wide and see-through, drawn underneath the ink.
5. **Eraser:** removes whole strokes it touches, like OneNote's stroke eraser.
6. **Growing downward:**
   - The canvas grows when you draw near its bottom edge.
   - A "More space" control under it adds room by hand.
7. **Full screen:**
   - The drawing fills the screen with the same toolbar.
   - Drawings keep their proportions between the block and full screen.
   - Escape or "Done" goes back.
8. **Undo and redo:** Cmd+Z and Cmd+Shift+Z inside a drawing undo and redo strokes and erasing.
9. **Saving and live reload:** drawings save with their page and live-reload from disk like everything else. An AI can add strokes by editing the JSON.
10. **The picture copy:** `<page folder>/drawing-<id>.svg` is rewritten whenever the page is saved with that drawing changed, and removed when the drawing is deleted.

## Non-goals

- Lasso selection, moving or resizing strokes, shapes, or handwriting recognition.
- An eraser that cuts strokes in half (only whole strokes are erased).
- Drawing on top of charts or text: a drawing is its own block.
- Pen tilt and rotation.

## Anti-goals

- **Lag while drawing:** the ink must follow the pen with no visible delay, even with hundreds of strokes on the page.
- **Fighting the page editor:** pen strokes must not select text, scroll the page, or start a block drag.
- **Losing strokes:** a stroke finished just before closing the app must be saved.
- **Huge or unreadable page files:** one line per stroke, not one line per number.

## File format

```json
{ "type": "drawing", "id": "d81k2m0q", "height": 420, "background": "grid",
  "strokes": [
    { "tool": "pen", "color": "ink", "size": 3, "pressure": true,
      "points": "120.5,80.2,0.42 121.3,81,0.47 123,83.4,0.55" }
  ] }
```

- **Coordinates:** a drawing is 1000 units wide, and `height` is in the same units, with y going down. `points` are `x,y,pressure` triples separated by spaces; pressure runs from 0 to 1.
- **Pressure:** `"pressure": false` marks mouse strokes, whose thickness is worked out from speed instead.
- **Tools:** `pen`, `pencil`, `marker` and `highlighter`.
- **Colours:** `ink`, `yellow`, `blue`, `green`, `red`, `purple` and `gray`.
- **Backgrounds:** `blank`, `grid` and `lines`.
- **The picture copy:** `<page folder>/drawing-<id>.svg`, where the page folder is the folder named like the page, the same one sub-pages go in. It's written by the app; edit the strokes, not the SVG.

## My calls

- **Rendering:** perfect-freehand (MIT) turns points and pressure into ink outlines, drawn as SVG paths. The same paths go into the picture copy.
- **Pen settings:**

  | tool | sizes | thinning | look |
  |---|---|---|---|
  | pen | 1.5 / 3 / 5 | 0.6 | ink colours |
  | pencil | 1 / 2 / 3.5 | 0.75, at 85% opacity | ink colours |
  | marker | 6 / 10 / 16 | 0.1, nearly even | ink colours |
  | highlighter | 14 / 22 / 32 | 0, even | mark tints, under the ink |
  | eraser | radius 8 / 16 / 32 | | |

- **Colours:** pens use each mark colour's strong ink shade, and the highlighter uses the see-through tint, the same palette as chart marks. The picture copy uses light-theme colours.
- **Size:** a new drawing is 1000 × 400. It grows by 300 when a finished stroke comes within 80 units of the bottom. "More space" adds 300.
- **Precision:** points are kept to 1 decimal place and pressure to 2.
- **Remembered pen:** the chosen tool, size, colour and background are remembered for the next drawing, in the app's own storage like the appearance settings.
- **Full screen** uses the window's real full screen (HTML Fullscreen API) with a page-coloured background. The canvas fits the screen width, up to 1600 px, and scrolls vertically.
- **Undo history** lasts as long as the drawing is open and isn't saved.
- **Saving the picture copy:** each page save carries that page's picture copies. Main writes a copy only when its text differs, and removes `drawing-*.svg` files whose drawing is gone. A page with drawings therefore has a folder even without sub-pages.
- **File names:** main only accepts picture-copy names of the form `drawing-<letters, digits, - or _>.svg`.

## How we'll know it works

1. `/drawing` inserts a block. Drawing with the mouse makes smooth strokes, and a pen (or a CDP pen event with `force`) makes strokes whose thickness follows pressure.
2. Each tool, size and colour draws as described. The highlighter sits under the ink, and the eraser removes the strokes it touches. Undo and redo work.
3. Drawing near the bottom grows the canvas, and "More space" grows it too.
4. Full screen opens the drawing on the whole screen. Strokes drawn there show in the block afterwards, in proportion.
5. The page JSON holds the strokes, one per line, and `<page folder>/drawing-<id>.svg` shows them. Deleting the block removes the SVG.
6. Editing the strokes in the JSON from outside updates the drawing live.
7. `npm test`, `npm run typecheck` and `npm run build` pass.
