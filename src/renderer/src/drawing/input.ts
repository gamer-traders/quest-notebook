/** What a pointerdown needs to say for the canvas to decide whether it starts anything. */
export interface PointerStart {
  pointerType: string;
  isPrimary: boolean;
  button: number;
  buttons: number;
}

/** The pen's eraser end: Wacom reports it as button 5, held down as buttons bit 32. */
export const isEraserEnd = (e: PointerStart) => e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);

/**
 * Whether a pointerdown starts a stroke or an erase: the primary pointer's main button, or the pen's eraser
 * end, and only while nothing else is drawing, so a palm or a second finger never cuts a stroke short.
 */
export function startsStroke(e: PointerStart, drawing: boolean): boolean {
  if (drawing || !e.isPrimary) return false;
  return e.button === 0 || isEraserEnd(e);
}
