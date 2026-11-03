import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DrawingCell } from '../types';
import { uid } from '../lib/cells';
import { DRAWING_WIDTH, SIZES, type InkColor, type PenTool, type Stroke } from './model';
import { outlineOf, strokePath, strokesHit } from './strokes';
import { RULE_GAP } from './svg';
import type { PenSettings } from './penSettings';
import { isEraserEnd, startsStroke } from './input';

/** A pen's pressure, or none for a mouse or a finger. Some pens report 0 for their first touch. */
const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5);

interface Live {
  pointerId: number;
  tool: PenTool | 'eraser';
  /** The ink, as it was when the pen went down. */
  color: InkColor;
  size: number;
  points: number[];
  pressure: boolean;
  erased: Set<string>;
}

/**
 * Strokes whose canvas went away under the pen, as when its page reloads from disk, by the canvas's liveKey.
 * The canvas that comes back in its place carries on with the stroke. If none does soon, the stroke is kept
 * as far as it was drawn.
 */
const parked = new Map<string, { live: Live; timer: ReturnType<typeof setTimeout> }>();
const PARK_MS = 1000;

interface Props {
  drawing: DrawingCell;
  pen: PenSettings;
  /** Takes no ink: the page is read-only while Claude works on it. */
  locked?: boolean;
  /** A finished stroke. */
  onStroke: (stroke: Stroke) => void;
  /** Strokes an eraser gesture took out, all at once when the pen lifts. */
  onErase: (ids: string[]) => void;
  /** An id that makes this canvas's background pattern unique on the page. */
  patternId: string;
  /** Names this canvas across remounts, so a stroke being drawn when it remounts goes on. */
  liveKey: string;
}

/**
 * Where ink goes on: an SVG 1000 units wide, scaled to fit. Pointer events give the pen's position and
 * pressure; coalesced events give every sample the tablet sent, so fast strokes stay smooth.
 */
export function DrawingCanvas({ drawing, pen, locked = false, onStroke, onErase, patternId, liveKey }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const live = useRef<Live | null>(null);
  const frame = useRef(0);
  const [liveD, setLiveD] = useState('');
  const [erased, setErased] = useState<Set<string>>(new Set());
  const [eraserAt, setEraserAt] = useState<{ x: number; y: number } | null>(null);

  /** Ends a stroke or an erase: the stroke is drawn, or the strokes the eraser touched go. */
  const end = (l: Live) => {
    if (l.tool === 'eraser') {
      if (l.erased.size) onErase([...l.erased]);
      setErased(new Set());
      return;
    }
    setLiveD('');
    onStroke({ id: uid(), tool: l.tool, color: l.color, size: l.size, pressure: l.pressure, points: l.points });
  };
  const ending = useRef(end);
  ending.current = end;

  // A stroke left by the canvas this one replaces goes on here, while the pen is still down.
  useEffect(() => {
    const waiting = parked.get(liveKey);
    if (waiting) {
      parked.delete(liveKey);
      clearTimeout(waiting.timer);
      const l = waiting.live;
      try {
        svg.current!.setPointerCapture(l.pointerId);
      } catch {
        // The pointer is gone.
      }
      if (svg.current!.hasPointerCapture(l.pointerId)) {
        live.current = l;
        if (l.tool === 'eraser') setErased(new Set(l.erased));
        else draw();
      } else {
        ending.current(l);
      }
    }
    return () => {
      cancelAnimationFrame(frame.current);
      const l = live.current;
      if (!l) return;
      live.current = null;
      const timer = setTimeout(() => {
        parked.delete(liveKey);
        ending.current(l);
      }, PARK_MS);
      parked.set(liveKey, { live: l, timer });
    };
  }, [liveKey]);

  const toDrawing = (e: PointerEvent): { x: number; y: number } => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = rect.width / DRAWING_WIDTH;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const draw = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const l = live.current;
      if (!l || l.tool === 'eraser') return;
      setLiveD(strokePath({ tool: l.tool, size: l.size, pressure: l.pressure, points: l.points }, false));
    });
  };

  const eraseAt = (x: number, y: number) => {
    const l = live.current!;
    const reach = SIZES.eraser[pen.size];
    const hits = strokesHit(
      drawing.strokes.filter((s) => !l.erased.has(s.id)),
      x,
      y,
      reach,
    );
    setEraserAt({ x, y });
    if (hits.length === 0) return;
    for (const id of hits) l.erased.add(id);
    setErased(new Set(l.erased));
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (locked || !startsStroke(e, live.current !== null)) return;
    const eraserEnd = isEraserEnd(e);
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    (e.currentTarget.parentElement as HTMLElement | null)?.focus({ preventScroll: true });
    const tool = eraserEnd ? 'eraser' : pen.tool;
    const { x, y } = toDrawing(e.nativeEvent);
    live.current = {
      pointerId: e.pointerId,
      tool,
      color: pen.color,
      size: SIZES[tool][pen.size],
      points: [x, y, pressureOf(e.nativeEvent)],
      pressure: e.pointerType === 'pen',
      erased: new Set(),
    };
    if (tool === 'eraser') eraseAt(x, y);
    else draw();
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const l = live.current;
    if (!l || l.pointerId !== e.pointerId) {
      // Show where the eraser would go, before it touches down.
      if (pen.tool === 'eraser' || isEraserEnd(e)) setEraserAt(toDrawing(e.nativeEvent));
      return;
    }
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [e.nativeEvent]) {
      const { x, y } = toDrawing(sample);
      if (l.tool === 'eraser') eraseAt(x, y);
      else l.points.push(x, y, pressureOf(sample));
    }
    if (l.tool !== 'eraser') draw();
  };

  const finish = (e: ReactPointerEvent<SVGSVGElement>) => {
    const l = live.current;
    if (!l || l.pointerId !== e.pointerId) return;
    live.current = null;
    cancelAnimationFrame(frame.current);
    end(l);
  };

  const shown = drawing.strokes.filter((s) => !erased.has(s.id));
  const liveTool = live.current?.tool;
  const rule = drawing.background === 'grid' ? `M ${RULE_GAP} 0 L 0 0 0 ${RULE_GAP}` : `M 0 ${RULE_GAP} L ${RULE_GAP} ${RULE_GAP}`;

  return (
    <svg
      ref={svg}
      className={`drawing-canvas tool-${pen.tool}${locked ? ' is-locked' : ''}`}
      viewBox={`0 0 ${DRAWING_WIDTH} ${drawing.height}`}
      role="img"
      aria-label="Drawing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onPointerLeave={() => !live.current && setEraserAt(null)}
    >
      {drawing.background !== 'blank' && (
        <>
          <defs>
            <pattern id={patternId} width={RULE_GAP} height={RULE_GAP} patternUnits="userSpaceOnUse">
              <path d={rule} className="drawing-rule" />
            </pattern>
          </defs>
          <rect width={DRAWING_WIDTH} height={drawing.height} fill={`url(#${patternId})`} />
        </>
      )}
      <g className="drawing-highlights">
        {shown.filter((s) => s.tool === 'highlighter').map((s) => (
          <path key={s.id} d={outlineOf(s)} className={`hl-${s.color}`} />
        ))}
        {liveD && liveTool === 'highlighter' && <path d={liveD} className={`hl-${pen.color}`} />}
      </g>
      <g className="drawing-ink">
        {shown.filter((s) => s.tool !== 'highlighter').map((s) => (
          <path key={s.id} d={outlineOf(s)} className={`ink-${s.color} tool-${s.tool}`} />
        ))}
        {liveD && liveTool !== 'highlighter' && <path d={liveD} className={`ink-${pen.color} tool-${liveTool}`} />}
      </g>
      {eraserAt && (pen.tool === 'eraser' || liveTool === 'eraser') && (
        <circle className="drawing-eraser" cx={eraserAt.x} cy={eraserAt.y} r={SIZES.eraser[pen.size]} />
      )}
    </svg>
  );
}
