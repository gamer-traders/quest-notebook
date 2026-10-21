// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DrawingCell, Notebook } from '../types';
import { useStore } from '../store';
import { DrawingCanvas } from './DrawingCanvas';
import { DrawingView } from './DrawingView';
import type { Stroke } from './model';
import type { PenSettings } from './penSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lays nothing out and has no pointer capture: the canvas is 1000 pixels wide at the origin, so a pixel is a
// drawing unit, and a pointer can be captured only while it is down, as in a browser.
const down = new Set<number>();
const captured = new Map<number, Element>();
const proto = Element.prototype as Element & Record<string, unknown>;
const saved = { rect: proto.getBoundingClientRect, set: proto.setPointerCapture, has: proto.hasPointerCapture, release: proto.releasePointerCapture };

beforeEach(() => {
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
  proto.setPointerCapture = function (this: Element, id: number) {
    if (down.has(id)) captured.set(id, this);
  };
  proto.hasPointerCapture = function (this: Element, id: number) {
    return captured.get(id) === this;
  };
  proto.releasePointerCapture = (id: number) => void captured.delete(id);
});

let root: Root;
let container: HTMLDivElement;
let strokes: Stroke[];

const drawing: DrawingCell = { id: 'd1', type: 'drawing', height: 400, background: 'blank', strokes: [] };
const pen: PenSettings = { tool: 'pen', color: 'blue', size: 1, background: 'blank' };

function show(key: string) {
  act(() => root.render(<DrawingCanvas key={key} drawing={drawing} pen={pen} onStroke={(s) => strokes.push(s)} onErase={() => {}} patternId="p" liveKey="n1/d1/page" />));
}

const svg = () => container.querySelector('svg.drawing-canvas')!;
const pointer = (type: string, x: number, y: number) => {
  if (type === 'pointerdown') down.add(1);
  if (type === 'pointerup') down.delete(1);
  act(() => void svg().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5, clientX: x, clientY: y })));
};
const xs = (s: Stroke) => s.points.filter((_, i) => i % 3 === 0);

beforeEach(() => {
  strokes = [];
  down.clear();
  captured.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.assign(proto, { getBoundingClientRect: saved.rect, setPointerCapture: saved.set, hasPointerCapture: saved.has, releasePointerCapture: saved.release });
  vi.useRealTimers();
});

test('a stroke runs from where the pen goes down to where it lifts', () => {
  show('first');
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 200, 120);
  pointer('pointerup', 200, 120);
  expect(strokes.map(xs)).toEqual([[100, 200]]);
});

test('a stroke being drawn when the canvas remounts carries on, and is drawn whole', () => {
  show('first');
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 200, 120);
  // The page reloads from disk under the pen.
  show('second');
  pointer('pointermove', 300, 140);
  pointer('pointerup', 300, 140);
  expect(strokes).toHaveLength(1);
  expect(xs(strokes[0])).toEqual([100, 200, 300]);
  expect(strokes[0]).toMatchObject({ tool: 'pen', color: 'blue', pressure: true });
});

test('a stroke whose pen lifted while the canvas was away is kept as far as it was drawn', () => {
  show('first');
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 200, 120);
  act(() => root.render(null));
  down.delete(1);
  show('second');
  expect(strokes.map(xs)).toEqual([[100, 200]]);
  // The pen hovering over the new canvas draws nothing more.
  pointer('pointermove', 300, 140);
  expect(strokes).toHaveLength(1);
});

test('a stroke being drawn when its canvas goes for good is kept', () => {
  vi.useFakeTimers();
  show('first');
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 200, 120);
  act(() => root.render(null));
  expect(strokes).toEqual([]);
  act(() => void vi.advanceTimersByTime(2000));
  expect(strokes.map(xs)).toEqual([[100, 200]]);
});

test('a stroke kept after its drawing left the screen joins the drawing as it is by then', () => {
  vi.useFakeTimers();
  const old: Stroke = { id: 'old', tool: 'pen', color: 'ink', size: 3, pressure: true, points: [10, 10, 0.5] };
  const fromDisk: Stroke = { ...old, id: 'from-disk' };
  const page: Notebook = { id: 'n1', title: 'N', spaceId: 'sm', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: { d1: { ...drawing, strokes: [old] } } };
  useStore.setState({ notebooks: [page] });
  act(() => root.render(<DrawingView notebookId="n1" drawing={page.items.d1 as DrawingCell} />));
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 200, 120);
  act(() => root.render(null));
  // The drawing changes on disk before the stroke is kept.
  useStore.getState().updateItem<DrawingCell>('n1', 'd1', { strokes: [old, fromDisk] });
  act(() => void vi.advanceTimersByTime(2000));
  const kept = useStore.getState().notebooks[0].items.d1 as DrawingCell;
  expect(kept.strokes.map((s) => s.id).slice(0, 2)).toEqual(['old', 'from-disk']);
  expect(kept.strokes.map(xs).slice(2)).toEqual([[100, 200]]);
});
