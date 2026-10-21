import type { MarkColor } from '../types';

/*
  A drawing: ink strokes on a canvas 1000 units wide that grows downward. Points are kept with the pen's
  pressure, so a stroke can be drawn again at any size, as thick as it was written.
*/

export type PenTool = 'pen' | 'pencil' | 'marker' | 'highlighter';
export type Tool = PenTool | 'eraser';
/** Ink is the page's own text colour: black on a light page, white on a dark one. */
export type InkColor = 'ink' | MarkColor;
export type Background = 'blank' | 'grid' | 'lines';

export interface Stroke {
  id: string;
  tool: PenTool;
  color: InkColor;
  size: number;
  /** True when the points carry a pen's real pressure. Mouse strokes get their thickness from speed instead. */
  pressure: boolean;
  /** Flat x, y, pressure triples, in drawing units. */
  points: number[];
}

export const DRAWING_WIDTH = 1000;
export const NEW_HEIGHT = 400;
export const GROW_BY = 300;
export const GROW_MARGIN = 80;

export const PEN_TOOLS: PenTool[] = ['pen', 'pencil', 'marker', 'highlighter'];
export const TOOLS: Tool[] = [...PEN_TOOLS, 'eraser'];
export const INK_COLORS: InkColor[] = ['ink', 'yellow', 'blue', 'green', 'red', 'purple', 'gray'];
export const BACKGROUNDS: Background[] = ['blank', 'grid', 'lines'];

/** Small, medium and large for each tool: line width for pens, the eraser's radius. */
export const SIZES: Record<Tool, [number, number, number]> = {
  pen: [1.5, 3, 5],
  pencil: [1, 2, 3.5],
  marker: [6, 10, 16],
  highlighter: [14, 22, 32],
  eraser: [8, 16, 32],
};
