# Drawing block: design

Date: 21 Oct 2026
Status: built. The owner asked to implement straight away and adjust afterwards, so everything under "My calls" is mine.

**Revised after review with the owner:** each drawing is one SVG file in the page's folder, both the picture and the data (strokes in `data-` attributes). The page JSON only references it. This keeps page files small and readable, and writes a drawing only when it changes.

**Hardened after a second review** (data safety): reading a drawing never writes its file; drawing ids and file names are repaired; strokes added inside a page merge into the file; main never overwrites a drawing changed outside, and moves files it didn't write to the Trash before replacing them; a page's drawings folder follows its page file when it's renamed outside the app.

## Intent

A **drawing** block for handwritten notes, like OneNote ink: sketching a chart shape, writing out a formula, or a quick note with a Wacom pen. It sits in a page like any other block, and it can be opened full screen to draw with more room.

## Decided with the owner

- **A new block type:** "drawing", with OneNote-like freehand ink.
- **Full screen:** the drawing can be opened full screen.
- **Pens and colours:** different pen types and colours.
- **Wacom pressure:** with a Wacom tablet, the pen's pressure sets the line's thickness.
- **Saved as vectors, readable by AI:** each drawing is one SVG file beside its page. Tools that look at images see the picture; tools that read text find each stroke's data on its path.
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
9. **Saving and live reload:** a drawing's file is written when the drawing changes, and live-reloads from disk like a page. An AI can add strokes by adding `<path data-points=…>` to the SVG, or a `strokes` list to the drawing block in the page.
10. **One file per drawing:** `<page folder>/drawing-<id>.svg` is the picture and the strokes. Removing the drawing in the app moves the file to the Trash.

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

In the page:

```json
{ "type": "drawing", "id": "d81k2m0q", "file": "drawing-d81k2m0q.svg" }
```

The drawing's file, `<page folder>/drawing-d81k2m0q.svg`, where the page folder is the folder named like the page file, the same one sub-pages go in:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 420" data-background="grid">
  <path data-tool="pen" data-color="ink" data-size="3" data-pressure="true"
        data-points="120.5,80.2,0.42 121.3,81,0.47" d="M120.4,79.6 Q …" fill="#17202a"/>
</svg>
```

- **Coordinates:** a drawing is 1000 units wide; the viewBox height is its height, with y going down. `data-points` are `x,y,pressure` triples separated by spaces; pressure runs from 0 to 1.
- **Pressure:** `data-pressure="false"` marks mouse strokes, whose thickness is worked out from speed instead.
- **Tools:** `pen`, `pencil`, `marker` and `highlighter`.
- **Colours:** `ink`, `yellow`, `blue`, `green`, `red`, `purple` and `gray`.
- **Backgrounds:** `blank`, `grid` and `lines`.
- **The points are the truth:** `d` is worked out from `data-points` whenever the app writes the drawing.
- **Ids:** letters, digits, `-` or `_`, at most 64, unique on the page ignoring case; the file is always `drawing-<id>.svg`. Others get a new id and their drawing is copied to the new file.

## My calls

- **Rendering:** perfect-freehand (MIT) turns points and pressure into ink outlines, drawn as SVG paths. The same paths go into the drawing's file.
- **Pen settings:**

  | tool | sizes | thinning | look |
  |---|---|---|---|
  | pen | 1.5 / 3 / 5 | 0.6 | ink colours |
  | pencil | 1 / 2 / 3.5 | 0.75, at 85% opacity | ink colours |
  | marker | 6 / 10 / 16 | 0.1, nearly even | ink colours |
  | highlighter | 14 / 22 / 32 | 0, even | mark tints, under the ink |
  | eraser | radius 8 / 16 / 32 | | |

- **Colours:** pens use each mark colour's strong ink shade, and the highlighter uses the see-through tint, the same palette as chart marks. The drawing's file uses light-theme colours.
- **Size:** a new drawing is 1000 × 400. It grows by 300 when a finished stroke comes within 80 units of the bottom. "More space" adds 300.
- **Precision:** points are kept to 1 decimal place and pressure to 2.
- **Remembered pen:** the chosen tool, size, colour and background are remembered for the next drawing, in the app's own storage like the appearance settings.
- **Full screen** uses the window's real full screen (HTML Fullscreen API) with a page-coloured background. The canvas fits the screen width, up to 1600 px, and scrolls vertically.
- **Undo history** lasts as long as the drawing is open and isn't saved.
- **Saving drawings:** a page save carries only the drawings that changed, and names the ones removed. Main writes drawing files before the page file, never overwrites a drawing changed outside since it last read it (the page is refused as stale and planned again), moves a file it didn't write to the Trash before replacing it, and trashes only drawings a save names. A page with drawings therefore has a folder even without sub-pages.
- **Reading never writes:** a missing drawing file shows an empty drawing and is never written; a hand-written file is shown as it is until someone draws in it.
- **A page's folder follows its file:** when a page file is renamed outside the app and its old folder holds only drawings, main moves that folder after it.
- **File names:** main only accepts drawing file names of the form `drawing-<letters, digits, - or _>.svg`.

## How we'll know it works

1. `/drawing` inserts a block. Drawing with the mouse makes smooth strokes, and a pen (or a CDP pen event with `force`) makes strokes whose thickness follows pressure.
2. Each tool, size and colour draws as described. The highlighter sits under the ink, and the eraser removes the strokes it touches. Undo and redo work.
3. Drawing near the bottom grows the canvas, and "More space" grows it too.
4. Full screen opens the drawing on the whole screen. Strokes drawn there show in the block afterwards, in proportion.
5. The page JSON holds one short line per drawing, and `<page folder>/drawing-<id>.svg` holds its strokes and shows them. Deleting the block moves the SVG to the Trash.
6. Adding a `<path data-points=…>` to the SVG from outside updates the drawing live. Renaming the page file outside brings its drawings folder along.
7. `npm test`, `npm run typecheck` and `npm run build` pass.
