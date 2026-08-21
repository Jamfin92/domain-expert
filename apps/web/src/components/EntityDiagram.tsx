import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Layout, LayoutNode } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The entity diagram: plain SVG over a server-computed layout.
 *
 * No d3 and no mermaid runtime. The layout is deterministic and arrives from
 * the API, so the picture is the same in the browser, in Electron, and in the
 * exported .mmd. All this component does is draw it and let you move around.
 *
 * Colours come from CSS variables, so the diagram follows the theme without a
 * second palette.
 */

interface Props {
  layout: Layout;
  selected: string | null;
  onSelect: (entity: string | null) => void;
}

const MIN_SCALE = 0.25;
/** Pointer travel, in pixels, before a press becomes a pan rather than a click. */
const DRAG_THRESHOLD = 4;
const MAX_SCALE = 2.5;

/** Where an edge should leave a box, given the box it is heading to. */
function anchor(from: LayoutNode, to: LayoutNode): { x1: number; y1: number; x2: number; y2: number } {
  const fromCx = from.x + from.width / 2;
  const toCx = to.x + to.width / 2;
  // Principals sit above dependents, so edges normally leave the bottom.
  if (to.y >= from.y + from.height) {
    return { x1: fromCx, y1: from.y + from.height, x2: toCx, y2: to.y };
  }
  if (from.y >= to.y + to.height) {
    return { x1: fromCx, y1: from.y, x2: toCx, y2: to.y + to.height };
  }
  // Same row (a self-reference or a cycle): go side to side.
  const leftToRight = fromCx < toCx;
  return {
    x1: leftToRight ? from.x + from.width : from.x,
    y1: from.y + from.height / 2,
    x2: leftToRight ? to.x : to.x + to.width,
    y2: to.y + to.height / 2,
  };
}

export function EntityDiagram({ layout, selected, onSelect }: Props): React.ReactElement {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  /** True once movement has passed the threshold and this is a pan, not a click. */
  const panning = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** Once you have moved the view, an idle resize must not yank it back. */
  const touched = useRef(false);

  /** Scale and centre the whole diagram inside the card. */
  const fit = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (cw === 0 || ch === 0 || layout.width === 0 || layout.height === 0) return;
    const s = Math.min(cw / layout.width, ch / layout.height, 1.2);
    setScale(s);
    setPan({ x: (cw - layout.width * s) / 2, y: (ch - layout.height * s) / 2 });
  }, [layout]);

  // Fit on first paint, so the diagram is never delivered already clipped.
  useLayoutEffect(() => {
    touched.current = false;
    fit();
  }, [fit]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const nodeByName = useMemo(
    () => new Map(layout.nodes.map((n) => [n.name, n])),
    [layout],
  );

  /** Entities one hop from the selection — everything else dims. */
  const related = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    for (const e of layout.edges) {
      if (e.from === selected) set.add(e.to);
      if (e.to === selected) set.add(e.from);
    }
    return set;
  }, [selected, layout.edges]);

  const onWheel = useCallback((ev: React.WheelEvent<SVGSVGElement>) => {
    ev.preventDefault();
    touched.current = true;
    setScale((s) => {
      const next = s * (ev.deltaY < 0 ? 1.1 : 1 / 1.1);
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    });
  }, []);

  const onPointerDown = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      if (ev.button !== 0) return;
      // Do NOT capture the pointer yet. Capturing on pointerdown retargets the
      // derived click to the capturing element, so a click on an entity is
      // delivered to the <svg> instead of the node and selection never
      // happens. Capture only once this turns out to be a drag.
      dragging.current = { x: ev.clientX, y: ev.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const onPointerMove = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    const d = dragging.current;
    if (!d) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (!panning.current) {
      // A few pixels of slop, so a slightly imprecise click is still a click.
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      panning.current = true;
      touched.current = true;
      svgRef.current?.setPointerCapture(ev.pointerId);
    }
    setPan({ x: d.panX + dx, y: d.panY + dy });
  }, []);

  const endDrag = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    dragging.current = null;
    if (panning.current) {
      panning.current = false;
      if (svgRef.current?.hasPointerCapture(ev.pointerId) === true) {
        svgRef.current.releasePointerCapture(ev.pointerId);
      }
    }
  }, []);

  const reset = useCallback(() => {
    touched.current = false;
    fit();
  }, [fit]);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden rounded-lg bg-background">
      <svg
        ref={svgRef}
        /* Named so a test can find the diagram rather than the first <svg> on
           the page, which is a lucide icon in the header. */
        data-psq="diagram"
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => {
          // Clicking empty canvas clears the selection; finishing a pan does not.
          if (e.target === svgRef.current && !panning.current) onSelect(null);
        }}
      >
        <defs>
          <marker
            id="psq-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--graph-edge)" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
          {layout.edges.map((e) => {
            const from = nodeByName.get(e.from);
            const to = nodeByName.get(e.to);
            if (!from || !to) return null;
            const { x1, y1, x2, y2 } = anchor(from, to);
            const dim = related !== null && !(related.has(e.from) && related.has(e.to));
            const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
            return (
              <g key={e.id} opacity={dim ? 0.12 : 1}>
                <path
                  d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={e.inferred ? "var(--graph-edge-inferred)" : "var(--graph-edge)"}
                  strokeWidth={1.5}
                  /* An inferred edge is drawn dashed: it was not declared in
                     the source, and the reader should be able to tell. */
                  strokeDasharray={e.inferred ? "5 4" : undefined}
                  markerEnd="url(#psq-arrow)"
                />
                {scale > 0.65 && e.label ? (
                  <text
                    x={mid.x}
                    y={mid.y - 4}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                    style={{ pointerEvents: "none" }}
                  >
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {layout.nodes.map((n) => {
            const isSelected = n.name === selected;
            const dim = related !== null && !related.has(n.name);
            const isHub = n.degree >= 5;
            return (
              <g
                key={n.name}
                data-psq="node"
                data-entity={n.name}
                transform={`translate(${n.x}, ${n.y})`}
                opacity={dim ? 0.2 : 1}
                className="cursor-pointer"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect(isSelected ? null : n.name);
                }}
              >
                <rect
                  width={n.width}
                  height={n.height}
                  rx={10}
                  fill="var(--graph-node)"
                  stroke={isSelected ? "var(--graph-hub)" : "var(--graph-node-border)"}
                  strokeWidth={isSelected ? 2.5 : 1}
                />
                {isHub ? (
                  <rect width={n.width} height={3} rx={1.5} fill="var(--graph-hub)" />
                ) : null}
                <text x={12} y={26} className="fill-foreground text-[13px] font-semibold">
                  {n.name}
                </text>
                <text x={12} y={42} className="fill-muted-foreground text-[10px]">
                  {n.degree} relation{n.degree === 1 ? "" : "s"}
                  {n.rowCount > 0 ? ` · ${n.rowCount} rows` : ""}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border bg-card/90 p-1 text-xs backdrop-blur">
        <button
          className="rounded px-2 py-1 hover:bg-accent"
          onClick={() => {
            touched.current = true;
            setScale((s) => Math.max(MIN_SCALE, s / 1.2));
          }}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="w-10 text-center tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <button
          className="rounded px-2 py-1 hover:bg-accent"
          onClick={() => {
            touched.current = true;
            setScale((s) => Math.min(MAX_SCALE, s * 1.2));
          }}
          aria-label="Zoom in"
        >
          +
        </button>
        <button className="rounded px-2 py-1 hover:bg-accent" onClick={reset}>
          Fit
        </button>
      </div>

      <div className={cn(
        "absolute bottom-3 left-3 flex items-center gap-3 rounded-md border bg-card/90 px-2.5 py-1.5",
        "text-[11px] text-muted-foreground backdrop-blur",
      )}>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="var(--graph-edge)" strokeWidth="1.5" /></svg>
          declared
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="var(--graph-edge-inferred)" strokeWidth="1.5" strokeDasharray="5 4" /></svg>
          by convention
        </span>
      </div>
    </div>
  );
}
