import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Stage, Layer, Image as KonvaImage, Line, Rect, Ellipse, Arrow, Text, Circle as KonvaCircle } from "react-konva";
import type Konva from "konva";
import {
  X, Pencil, Square, MoveUpRight, Circle, Type, MapPin, Undo2, Redo2, Trash2, Save, Loader2, FileText, PenSquare,
} from "lucide-react";
import { getRoomBlueprint } from "@/api/roomMasterApi";
import {
  getBlueprintAnnotation,
  saveBlueprintAnnotation,
  type BlueprintAnnotationContext,
} from "@/api/dependencyActivityAssignmentApi";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { useOverlayBackClose } from "@/hooks/useOverlayBackClose";

// ── Shape model ──────────────────────────────────────────────────────────
// A plain discriminated union serialized straight to JSON — no need for
// anything heavier at this scale (a handful of shapes per blueprint).
interface ShapeBase {
  id: string;
  stroke: string;
  strokeWidth: number;
}
interface PenShape extends ShapeBase { type: "pen"; points: number[]; }
interface RectShapeT extends ShapeBase { type: "rect"; x: number; y: number; width: number; height: number; }
interface ArrowShapeT extends ShapeBase { type: "arrow"; points: number[]; }
interface EllipseShapeT extends ShapeBase { type: "ellipse"; x: number; y: number; radiusX: number; radiusY: number; }
interface TextShapeT extends ShapeBase { type: "text"; x: number; y: number; text: string; fontSize: number; }
// A single click, not a drag — x/y is the exact point being marked (the
// pin's tip), same one-click-to-place pattern as the Text tool.
interface PinShapeT extends ShapeBase { type: "pin"; x: number; y: number; }
type Shape = PenShape | RectShapeT | ArrowShapeT | EllipseShapeT | TextShapeT | PinShapeT;

type Tool = "pen" | "rect" | "arrow" | "ellipse" | "text" | "pin";

const TOOLS: { id: Tool; icon: React.ElementType; label: string }[] = [
  { id: "pen", icon: Pencil, label: "Freehand" },
  { id: "rect", icon: Square, label: "Rectangle" },
  { id: "arrow", icon: MoveUpRight, label: "Arrow" },
  { id: "ellipse", icon: Circle, label: "Ellipse" },
  { id: "text", icon: Type, label: "Text" },
  { id: "pin", icon: MapPin, label: "Location Pin" },
];

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#000000"];

// Reference-layer shapes (the other context's markup, shown locked
// underneath) render in a single neutral color regardless of what they
// were actually drawn in, at reduced opacity — so they read as background
// context, never confusable with what's currently editable.
const REFERENCE_COLOR = "#94a3b8";
const REFERENCE_OPACITY = 0.5;

const CONTEXT_LABEL: Record<BlueprintAnnotationContext, string> = {
  allocation: "Allocation",
  reporting: "Reporting",
};
// Default drawing color per context — distinguishes the two layers even
// without opening both side by side (allocation red, reporting green).
const CONTEXT_DEFAULT_COLOR: Record<BlueprintAnnotationContext, string> = {
  allocation: "#ef4444",
  reporting: "#22c55e",
};

function uid() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// Shapes are drawn (and kept in local state) in Stage/display-pixel
// coordinates, which depend on how large the canvas happens to render at
// that moment — itself a function of the viewport. Persisted JSON instead
// stores 0..1 coordinates normalized to the image's own natural width/
// height, which never changes, so a save from a small window and a load
// on a large one (or the reference-context layer loaded from a different
// session entirely) still land in the same spot on the blueprint.
function scaleShapes(shapes: Shape[], sx: number, sy: number): Shape[] {
  return shapes.map((s) => {
    if (s.type === "pen" || s.type === "arrow") {
      const points = s.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
      return { ...s, points };
    }
    if (s.type === "rect") return { ...s, x: s.x * sx, y: s.y * sy, width: s.width * sx, height: s.height * sy };
    if (s.type === "ellipse") return { ...s, x: s.x * sx, y: s.y * sy, radiusX: s.radiusX * sx, radiusY: s.radiusY * sy };
    return { ...s, x: s.x * sx, y: s.y * sy };
  });
}

// A drop-pin glyph built from plain shapes (circle head + triangular tip)
// rather than SVG path data — x/y is the exact point marked, landing at
// the tip's point, not the head's center.
function PinGlyph({ s, colorOverride }: { s: PinShapeT; colorOverride?: string }) {
  const color = colorOverride ?? s.stroke;
  const r = 5 + s.strokeWidth;
  const headY = s.y - r * 1.8;
  return (
    <>
      <Line
        points={[s.x - r * 0.5, headY + r * 0.4, s.x, s.y, s.x + r * 0.5, headY + r * 0.4]}
        closed
        fill={color}
        stroke={color}
      />
      <KonvaCircle x={s.x} y={headY} radius={r} fill={color} stroke={color} />
      <KonvaCircle x={s.x} y={headY} radius={r * 0.4} fill="#ffffff" />
    </>
  );
}

export default function BlueprintAnnotationEditor({
  rungId,
  roomId,
  roomLabel,
  editableContext = "allocation",
  referenceContext,
  onClose,
}: {
  rungId: number;
  roomId: number;
  roomLabel: string;
  /** Which markup layer this editor session writes to — "allocation" (Work
   *  Allocation, the default) or "reporting" (Work Reporting, field
   *  engineers). See migration 346. */
  editableContext?: BlueprintAnnotationContext;
  /** The other context's markup, shown locked/dimmed underneath as
   *  read-only background — e.g. Work Reporting shows the allocation
   *  markup for reference while drawing the reporting layer on top. */
  referenceContext?: BlueprintAnnotationContext;
  onClose: () => void;
}) {
  useOverlayBackClose(onClose);
  const queryClient = useQueryClient();
  const stageRef = useRef<Konva.Stage>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  const { data: blueprint, isLoading: blueprintLoading } = useQuery({
    queryKey: ["room-blueprint", roomId],
    queryFn: () => getRoomBlueprint(roomId),
  });
  const { data: annotation, isLoading: annotationLoading } = useQuery({
    queryKey: ["blueprint-annotation", rungId, roomId, editableContext],
    queryFn: () => getBlueprintAnnotation(rungId, roomId, editableContext),
  });
  const { data: referenceAnnotation } = useQuery({
    queryKey: ["blueprint-annotation", rungId, roomId, referenceContext],
    queryFn: () => getBlueprintAnnotation(rungId, roomId, referenceContext!),
    enabled: !!referenceContext,
  });
  const referenceShapes = useMemo<Shape[]>(() => {
    if (!referenceAnnotation?.shapesJson) return [];
    try {
      return JSON.parse(referenceAnnotation.shapesJson) as Shape[];
    } catch {
      return [];
    }
  }, [referenceAnnotation]);

  // naturalImage is the loaded HTMLImageElement at its own pixel size;
  // image/imageSize is what's actually handed to Konva, scaled down to fit
  // whatever room canvasAreaRef actually has available (tracked via
  // ResizeObserver below) — both width AND height are constrained so the
  // whole blueprint is always visible with no page/canvas scrolling.
  const [naturalImage, setNaturalImage] = useState<HTMLImageElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [history, setHistory] = useState<Shape[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(CONTEXT_DEFAULT_COLOR[editableContext]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [hydrated, setHydrated] = useState(false);
  const drawingShapeId = useRef<string | null>(null);

  const isPdf = blueprint?.mimeType === "application/pdf";

  // Load the room's blueprint image (JPG/PNG) into a plain HTMLImageElement
  // — Konva.Image accepts that directly, no need for the react-konva-utils
  // useImage helper for a one-off load like this.
  useEffect(() => {
    if (!blueprint || isPdf) return;
    const img = new window.Image();
    img.onload = () => setNaturalImage(img);
    img.src = `data:${blueprint.mimeType};base64,${blueprint.dataBase64}`;
  }, [blueprint, isPdf]);

  // Track the canvas area's actual available box — it mounts as soon as
  // the blueprint/annotation queries resolve (not gated on the image being
  // ready), so this can measure it before the image itself has loaded.
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [blueprintLoading, annotationLoading, isPdf, blueprint]);

  // Fit the natural image into whatever space is actually available —
  // capped at 1 (never upscale a small blueprint past its real resolution).
  useEffect(() => {
    if (!naturalImage || containerSize.width === 0 || containerSize.height === 0) return;
    const scale = Math.min(containerSize.width / naturalImage.width, containerSize.height / naturalImage.height, 1);
    setImageSize({ width: naturalImage.width * scale, height: naturalImage.height * scale });
    setImage(naturalImage);
  }, [naturalImage, containerSize]);

  // Hydrate saved shapes once — waits on imageSize too (not just the
  // annotation query) since denormalizing needs the actual display size
  // the canvas ended up fitting to.
  useEffect(() => {
    if (hydrated || annotationLoading || imageSize.width === 0) return;
    if (annotation?.shapesJson) {
      try {
        const normalized = JSON.parse(annotation.shapesJson) as Shape[];
        const parsed = scaleShapes(normalized, imageSize.width, imageSize.height);
        setShapes(parsed);
        setHistory([parsed]);
        setHistoryIndex(0);
      } catch {
        // Corrupt/old data — start blank rather than crash the editor.
      }
    }
    setHydrated(true);
  }, [annotation, annotationLoading, hydrated, imageSize]);

  // Reference layer (the other context's markup) — denormalized the same
  // way, recomputed whenever imageSize settles.
  const referenceShapesDisplay = useMemo(
    () => (imageSize.width > 0 ? scaleShapes(referenceShapes, imageSize.width, imageSize.height) : []),
    [referenceShapes, imageSize],
  );

  const pushHistory = (next: Shape[]) => {
    const truncated = history.slice(0, historyIndex + 1);
    const nextHistory = [...truncated, next];
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  const commitShapes = (next: Shape[]) => {
    setShapes(next);
    pushHistory(next);
  };

  const undo = () => {
    if (historyIndex === 0) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    setShapes(history[idx]);
  };
  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    setShapes(history[idx]);
  };
  const clearAll = () => {
    if (shapes.length === 0) return;
    if (!window.confirm("Clear every marking on this blueprint? This can still be undone.")) return;
    commitShapes([]);
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;

    if (tool === "text") {
      const text = window.prompt("Text to place on the blueprint:");
      if (!text || !text.trim()) return;
      commitShapes([...shapes, { id: uid(), type: "text", x: pos.x, y: pos.y, text: text.trim(), fontSize: 16, stroke: color, strokeWidth }]);
      return;
    }

    if (tool === "pin") {
      commitShapes([...shapes, { id: uid(), type: "pin", x: pos.x, y: pos.y, stroke: color, strokeWidth }]);
      return;
    }

    const id = uid();
    drawingShapeId.current = id;
    let newShape: Shape;
    if (tool === "pen") newShape = { id, type: "pen", points: [pos.x, pos.y], stroke: color, strokeWidth };
    else if (tool === "rect") newShape = { id, type: "rect", x: pos.x, y: pos.y, width: 0, height: 0, stroke: color, strokeWidth };
    else if (tool === "arrow") newShape = { id, type: "arrow", points: [pos.x, pos.y, pos.x, pos.y], stroke: color, strokeWidth };
    else newShape = { id, type: "ellipse", x: pos.x, y: pos.y, radiusX: 0, radiusY: 0, stroke: color, strokeWidth };
    setShapes((prev) => [...prev, newShape]);
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = drawingShapeId.current;
    if (!id) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (s.type === "pen") return { ...s, points: [...s.points, pos.x, pos.y] };
        if (s.type === "rect") return { ...s, width: pos.x - s.x, height: pos.y - s.y };
        if (s.type === "arrow") return { ...s, points: [s.points[0], s.points[1], pos.x, pos.y] };
        if (s.type === "ellipse") return { ...s, radiusX: Math.abs(pos.x - s.x), radiusY: Math.abs(pos.y - s.y) };
        return s;
      }),
    );
  };

  const handleMouseUp = () => {
    if (!drawingShapeId.current) return;
    drawingShapeId.current = null;
    // Commit the in-progress shape's final state onto the undo stack.
    setShapes((prev) => {
      pushHistory(prev);
      return prev;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const normalized = imageSize.width > 0 ? scaleShapes(shapes, 1 / imageSize.width, 1 / imageSize.height) : shapes;
      const shapesJson = JSON.stringify(normalized);
      const thumbnail = stageRef.current
        ? stageRef.current.toDataURL({ pixelRatio: 0.5 }).replace(/^data:image\/png;base64,/, "")
        : null;
      return saveBlueprintAnnotation(rungId, {
        roomId,
        context: editableContext,
        shapesJson,
        thumbnail,
        version: annotation?.version ?? 0,
      });
    },
    onSuccess: () => {
      toast.success("Blueprint markup saved");
      queryClient.invalidateQueries({ queryKey: ["blueprint-annotation", rungId, roomId, editableContext] });
      onClose();
    },
    onError: (err: any) => toast.error(err.message || "Could not save markup"),
  });

  const loading = blueprintLoading || annotationLoading;

  // Portalled straight to <body> — this editor can be opened from deep
  // inside a table row (Reporting page), and a nested position:fixed
  // element only actually covers the real viewport if nothing between it
  // and <body> establishes its own containing block (any ancestor with a
  // transform/filter/perspective, which framer-motion's animated wrappers
  // set inline). Rendering inline here, the modal was visibly clipped to
  // whatever box its nearest such ancestor occupied instead of the full
  // screen — sidebar and table content bled through around/behind it.
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[90vh] rounded-2xl overflow-hidden">
        <CivilWorkDprShell
          fillHeight
          title={`Blueprint Markup — ${CONTEXT_LABEL[editableContext]}`}
          subtitle={roomLabel}
          icon={PenSquare}
          action={
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={18} />
            </button>
          }
        >
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        ) : !blueprint ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-20 text-center px-6">
            <FileText size={28} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No blueprint uploaded for this room yet — upload one from Setup &gt; Room Master, then come back here to mark it up.
            </p>
          </div>
        ) : isPdf ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-center px-6">
            <FileText size={28} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm">
              PDF blueprints can't be marked up here yet — only JPG/PNG blueprints support the drawing canvas right now.
            </p>
            <a
              href={`data:${blueprint.mimeType};base64,${blueprint.dataBase64}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Open the PDF instead
            </a>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.label}
                    onClick={() => setTool(t.id)}
                    className={`p-1.5 rounded-md transition-colors ${tool === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <t.icon size={15} />
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? "scale-110 border-primary" : "border-border"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>

              <select
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs"
              >
                {[1, 2, 3, 5, 8].map((w) => (
                  <option key={w} value={w}>{w}px</option>
                ))}
              </select>

              <div className="flex items-center gap-1 ml-auto">
                <button type="button" onClick={undo} disabled={historyIndex === 0} title="Undo" className="p-1.5 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors">
                  <Undo2 size={15} />
                </button>
                <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1} title="Redo" className="p-1.5 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors">
                  <Redo2 size={15} />
                </button>
                <button type="button" onClick={clearAll} title="Clear all" className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {(annotation?.updatedBy || (referenceContext && referenceShapesDisplay.length > 0)) && (
              <div className="px-5 py-1.5 border-b border-border shrink-0 bg-muted/20 flex flex-wrap items-center gap-x-4 gap-y-1">
                {annotation?.updatedBy && (
                  <p className="text-[11px] text-muted-foreground">
                    Last marked up by <span className="font-medium text-foreground">{annotation.updatedBy}</span>
                    {annotation.updatedAt && ` on ${new Date(annotation.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                  </p>
                )}
                {referenceContext && referenceShapesDisplay.length > 0 && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: REFERENCE_COLOR, opacity: REFERENCE_OPACITY }} />
                    Grey markup shown underneath is {CONTEXT_LABEL[referenceContext]}'s — locked, for reference only
                  </p>
                )}
              </div>
            )}

            {/* Canvas — sized exactly to fit this box (see the ResizeObserver
                effect above), so nothing here ever needs to scroll. */}
            <div ref={canvasAreaRef} className="flex-1 min-h-0 overflow-hidden flex items-center justify-center bg-muted/20 p-4">
              {imageSize.width === 0 ? (
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              ) : (
                <Stage
                  ref={stageRef}
                  width={imageSize.width}
                  height={imageSize.height}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  className="rounded-lg border border-border shadow-sm bg-white"
                  style={{ cursor: "crosshair" }}
                >
                  <Layer listening={false}>
                    {image && <KonvaImage image={image} width={imageSize.width} height={imageSize.height} />}
                  </Layer>
                  {referenceContext && referenceShapesDisplay.length > 0 && (
                    <Layer listening={false} opacity={REFERENCE_OPACITY}>
                      {referenceShapesDisplay.map((s) => {
                        if (s.type === "pen") return <Line key={s.id} points={s.points} stroke={REFERENCE_COLOR} strokeWidth={s.strokeWidth} tension={0.4} lineCap="round" lineJoin="round" />;
                        if (s.type === "rect") return <Rect key={s.id} x={s.x} y={s.y} width={s.width} height={s.height} stroke={REFERENCE_COLOR} strokeWidth={s.strokeWidth} />;
                        if (s.type === "arrow") return <Arrow key={s.id} points={s.points} stroke={REFERENCE_COLOR} fill={REFERENCE_COLOR} strokeWidth={s.strokeWidth} />;
                        if (s.type === "ellipse") return <Ellipse key={s.id} x={s.x} y={s.y} radiusX={s.radiusX} radiusY={s.radiusY} stroke={REFERENCE_COLOR} strokeWidth={s.strokeWidth} />;
                        if (s.type === "pin") return <PinGlyph key={s.id} s={s} colorOverride={REFERENCE_COLOR} />;
                        return <Text key={s.id} x={s.x} y={s.y} text={s.text} fontSize={s.fontSize} fill={REFERENCE_COLOR} />;
                      })}
                    </Layer>
                  )}
                  <Layer>
                    {shapes.map((s) => {
                      if (s.type === "pen") return <Line key={s.id} points={s.points} stroke={s.stroke} strokeWidth={s.strokeWidth} tension={0.4} lineCap="round" lineJoin="round" />;
                      if (s.type === "rect") return <Rect key={s.id} x={s.x} y={s.y} width={s.width} height={s.height} stroke={s.stroke} strokeWidth={s.strokeWidth} />;
                      if (s.type === "arrow") return <Arrow key={s.id} points={s.points} stroke={s.stroke} fill={s.stroke} strokeWidth={s.strokeWidth} />;
                      if (s.type === "ellipse") return <Ellipse key={s.id} x={s.x} y={s.y} radiusX={s.radiusX} radiusY={s.radiusY} stroke={s.stroke} strokeWidth={s.strokeWidth} />;
                      if (s.type === "pin") return <PinGlyph key={s.id} s={s} />;
                      return <Text key={s.id} x={s.x} y={s.y} text={s.text} fontSize={s.fontSize} fill={s.stroke} />;
                    })}
                  </Layer>
                </Stage>
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5"
          >
            Close
          </button>
          {blueprint && !isPdf && (
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-opacity whitespace-nowrap"
            >
              {saveMutation.isPending ? (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={12} />
              )}
              {saveMutation.isPending ? "Saving…" : "Save Markup"}
            </button>
          )}
        </div>
        </div>
        </CivilWorkDprShell>
      </div>
    </div>,
    document.body,
  );
}
