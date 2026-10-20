import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { MarkLine, MarkWidth, TrendPoint } from '../types';
import { logicalToX } from './coords';
import { hitTestShapes, type MarkShape } from './hitTest';

/** How one mark is painted, already resolved from its colour and the theme. */
export interface Paint {
  fill: string;
  ink: string;
  line: MarkLine;
  width: MarkWidth;
  /** Selected or under the pointer: drawn stronger, with handles. */
  active: boolean;
}

export interface DrawingsInput {
  levels: ({ id: string; price: number } & Paint)[];
  trends: ({ id: string; a: TrendPoint; b: TrendPoint; draft?: boolean } & Paint)[];
  texts: { id: string; time: number; price: number; text: string; fill: string; active: boolean }[];
  toLogical: (time: number) => number | null;
  /** Colour of text-label lettering, which stays readable whatever the label colour. */
  textInk: string;
}

const HALF: Record<MarkWidth, number> = { thin: 3, normal: 5, thick: 8 };
const CORE: Record<MarkWidth, number> = { thin: 1, normal: 1.5, thick: 2.5 };
const DASH: Record<MarkLine, number[]> = { solid: [], dashed: [7, 5], dotted: [0.5, 4] };

export const TEXT_FONT = '500 12px "Instrument Sans", system-ui, sans-serif';
const TEXT_PAD = 6;
const TEXT_HEIGHT = 20;

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = TEXT_FONT;
  return measureCtx.measureText(text).width;
}

interface BandGeom extends Paint {
  id: string;
  y: number;
}
interface SegmentGeom extends Paint {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  draft: boolean;
}
interface TextGeom {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  fill: string;
  active: boolean;
}

/**
 * Your own marks, drawn like a highlighter: levels are wide see-through bands behind the
 * candles, trend lines are strokes on top with a thin core so the exact price stays readable,
 * and text labels sit on a highlighter swatch. It also tells the chart which mark is under
 * the pointer, for tooltips and selection.
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private input: DrawingsInput | null = null;
  private bands: BandGeom[] = [];
  private segments: SegmentGeom[] = [];
  private labels: TextGeom[] = [];
  private shapes: MarkShape[] = [];
  private readonly views: IPrimitivePaneView[];

  /** @param onLayout runs on every chart redraw, for DOM overlays that must track the chart. */
  constructor(private readonly onLayout?: () => void) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => this.drawStrokes(target),
      drawBackground: (target) => this.drawBands(target),
    };
    this.views = [{ renderer: () => renderer, zOrder: () => 'top' }];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  set(input: DrawingsInput) {
    this.input = input;
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.onLayout?.();
    const { chart, series, input } = this;
    this.bands = [];
    this.segments = [];
    this.labels = [];
    this.shapes = [];
    if (!chart || !series || !input) return;
    const ts = chart.timeScale();
    const xOf = (time: number) => {
      const l = input.toLogical(time);
      return l === null ? null : logicalToX(ts, l);
    };

    for (const l of input.levels) {
      const y = series.priceToCoordinate(l.price);
      if (y === null) continue;
      this.bands.push({ ...l, y });
      this.shapes.push({ id: l.id, kind: 'band', y, half: HALF[l.width] });
    }
    for (const t of input.trends) {
      const x1 = xOf(t.a.time);
      const x2 = xOf(t.b.time);
      const y1 = series.priceToCoordinate(t.a.price);
      const y2 = series.priceToCoordinate(t.b.price);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      this.segments.push({ ...t, x1, y1, x2, y2, draft: !!t.draft });
      if (!t.draft) this.shapes.push({ id: t.id, kind: 'segment', x1, y1, x2, y2, half: HALF[t.width] });
    }
    for (const t of input.texts) {
      const x = xOf(t.time);
      const yMid = series.priceToCoordinate(t.price);
      if (x === null || yMid === null) continue;
      const w = textWidth(t.text) + TEXT_PAD * 2;
      const y = yMid - TEXT_HEIGHT / 2;
      this.labels.push({ id: t.id, x, y, w, text: t.text, fill: t.fill, active: t.active });
      this.shapes.push({ id: t.id, kind: 'box', x, y, w, h: TEXT_HEIGHT });
    }
  }

  paneViews() {
    return this.views;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const id = hitTestShapes(this.shapes, x, y);
    return id ? { externalId: id, zOrder: 'top', cursorStyle: 'pointer' } : null;
  }

  private drawBands(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vr, bitmapSize }) => {
      for (const b of this.bands) {
        const half = Math.round(HALF[b.width] * vr);
        const yy = Math.round(b.y * vr);
        ctx.fillStyle = b.fill;
        ctx.fillRect(0, yy - half, bitmapSize.width, half * 2);
        if (b.active) ctx.fillRect(0, yy - half, bitmapSize.width, half * 2);
      }
    });
  }

  private drawStrokes(target: CanvasRenderingTarget2D) {
    const input = this.input;
    if (!input) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      const dash = (line: MarkLine) => DASH[line].map((d) => d * hr);

      for (const b of this.bands) {
        const yy = Math.round(b.y * vr) + 0.5;
        ctx.strokeStyle = b.ink;
        ctx.lineWidth = Math.max(1, CORE[b.width] * vr);
        ctx.lineCap = b.line === 'dotted' ? 'round' : 'butt';
        ctx.setLineDash(dash(b.line));
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(bitmapSize.width, yy);
        ctx.stroke();
        if (b.active) {
          ctx.setLineDash([]);
          ctx.fillStyle = b.ink;
          for (const x of [12 * hr, bitmapSize.width - 12 * hr]) ctx.fillRect(x - 4 * hr, yy - 4 * vr, 8 * hr, 8 * vr);
        }
      }

      for (const s of this.segments) {
        const x1 = s.x1 * hr;
        const y1 = s.y1 * vr;
        const x2 = s.x2 * hr;
        const y2 = s.y2 * vr;
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
        ctx.strokeStyle = s.fill;
        ctx.lineWidth = HALF[s.width] * 2 * hr * (s.active ? 1.3 : 1);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.strokeStyle = s.ink;
        ctx.lineWidth = CORE[s.width] * hr;
        ctx.setLineDash(s.draft ? [4 * hr, 4 * hr] : dash(s.line));
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.setLineDash([]);
        for (const [x, y] of [
          [x1, y1],
          [x2, y2],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, (s.active ? 4.5 : 3) * hr, 0, Math.PI * 2);
          ctx.fillStyle = s.active ? input.textInk : s.ink;
          ctx.fill();
          if (s.active) {
            ctx.lineWidth = 2 * hr;
            ctx.strokeStyle = s.ink;
            ctx.stroke();
          }
        }
      }

      ctx.font = TEXT_FONT.replace('12px', `${12 * vr}px`);
      ctx.textBaseline = 'middle';
      for (const l of this.labels) {
        const x = l.x * hr;
        const y = l.y * vr;
        const w = l.w * hr;
        const h = TEXT_HEIGHT * vr;
        ctx.fillStyle = l.fill;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3 * hr);
        ctx.fill();
        if (l.active) {
          ctx.lineWidth = 1.5 * hr;
          ctx.strokeStyle = input.textInk;
          ctx.stroke();
        }
        ctx.fillStyle = input.textInk;
        ctx.fillText(l.text, x + TEXT_PAD * hr, y + h / 2);
      }
    });
  }
}
