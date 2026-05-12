import React, { useCallback, useMemo, useRef, useState } from "react";

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QRPlacementOverlayProps {
  placement: Placement;
  onPlacementChange: (placement: Placement) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  imageWidth: number;
  imageHeight: number;
}

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type DragMode = "move" | "resize";

interface DragSession {
  mode: DragMode;
  handle: ResizeHandle | null;
  startPos: { x: number; y: number };
  startPlacement: Placement;
}

const MIN_SIZE_RATIO = 0.05;

// Constrain placement to a valid square within image bounds.
function constrainPlacement(
  p: Placement,
  imageWidth: number,
  imageHeight: number,
): Placement {
  let { x, y, width, height } = p;
  const widthPx = width * imageWidth;
  const heightPx = height * imageHeight;
  const sizePx = Math.min(widthPx, heightPx);
  width = sizePx / imageWidth;
  height = sizePx / imageHeight;

  const minSizePx = MIN_SIZE_RATIO * Math.min(imageWidth, imageHeight);
  const minNormalized = minSizePx / Math.min(imageWidth, imageHeight);
  width = Math.max(minNormalized, Math.min(width, 1));
  height = Math.max(minNormalized, Math.min(height, 1));
  x = Math.max(0, Math.min(x, 1 - width));
  y = Math.max(0, Math.min(y, 1 - height));
  return { x, y, width, height };
}

// Compute placement after resizing from a given handle.
function resizeFromHandle(
  handle: ResizeHandle,
  start: Placement,
  deltaXPx: number,
  deltaYPx: number,
  imageWidth: number,
  imageHeight: number,
): Placement {
  const startXPx = start.x * imageWidth;
  const startYPx = start.y * imageHeight;
  const startSizePx = Math.min(
    start.width * imageWidth,
    start.height * imageHeight,
  );
  const sizeDeltaPx = Math.max(Math.abs(deltaXPx), Math.abs(deltaYPx));

  let sizeChange = 0;
  let newX = startXPx;
  let newY = startYPx;

  switch (handle) {
    case "nw":
      sizeChange = deltaXPx < 0 || deltaYPx < 0 ? sizeDeltaPx : -sizeDeltaPx;
      newX = startXPx - sizeChange;
      newY = startYPx - sizeChange;
      break;
    case "ne":
      sizeChange = deltaXPx > 0 || deltaYPx < 0 ? sizeDeltaPx : -sizeDeltaPx;
      newY = startYPx - sizeChange;
      break;
    case "sw":
      sizeChange = deltaXPx < 0 || deltaYPx > 0 ? sizeDeltaPx : -sizeDeltaPx;
      newX = startXPx - sizeChange;
      break;
    case "se":
      sizeChange = deltaXPx > 0 || deltaYPx > 0 ? sizeDeltaPx : -sizeDeltaPx;
      break;
  }

  const newSize = startSizePx + sizeChange;
  return {
    x: newX / imageWidth,
    y: newY / imageHeight,
    width: newSize / imageWidth,
    height: newSize / imageHeight,
  };
}

const HANDLE_SIZE = 8;

const HANDLE_BASE_STYLE: React.CSSProperties = {
  width: `${HANDLE_SIZE}px`,
  height: `${HANDLE_SIZE}px`,
  backgroundColor: "var(--primary)",
  border: "2px solid white",
  borderRadius: "2px",
  position: "absolute",
  cursor: "pointer",
  zIndex: 10,
};

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nw-resize",
  ne: "ne-resize",
  sw: "sw-resize",
  se: "se-resize",
};

interface ResizeHandleButtonProps {
  handle: ResizeHandle;
  onMouseDown: (e: React.MouseEvent, handle: ResizeHandle) => void;
}

function ResizeHandleButton({ handle, onMouseDown }: ResizeHandleButtonProps) {
  const offset = `-${HANDLE_SIZE / 2}px`;
  const positional: React.CSSProperties = {};
  if (handle === "nw") {
    positional.left = offset;
    positional.top = offset;
  } else if (handle === "ne") {
    positional.right = offset;
    positional.top = offset;
  } else if (handle === "sw") {
    positional.left = offset;
    positional.bottom = offset;
  } else {
    positional.right = offset;
    positional.bottom = offset;
  }
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`Resize from ${handle} corner`}
      style={{
        ...HANDLE_BASE_STYLE,
        ...positional,
        cursor: HANDLE_CURSORS[handle],
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, handle);
      }}
    />
  );
}

export function QRPlacementOverlay({
  placement,
  onPlacementChange,
  containerRef,
  imageWidth,
  imageHeight,
}: QRPlacementOverlayProps) {
  // dragMode is the only piece of state we need in render (drives cursor).
  const [dragMode, setDragMode] = useState<DragMode | null>(null);

  // The active drag session is only read inside handlers; a ref avoids
  // re-renders and effect re-subscriptions on every mousemove.
  const sessionRef = useRef<DragSession | null>(null);

  // Mirror the latest onPlacementChange in a ref so the document-level
  // mousemove listener doesn't need to be re-bound when the prop identity
  // changes.
  const onPlacementChangeRef = useRef(onPlacementChange);
  onPlacementChangeRef.current = onPlacementChange;

  const constrainedPlacement = useMemo(
    () => constrainPlacement(placement, imageWidth, imageHeight),
    [placement, imageWidth, imageHeight],
  );

  const getMousePos = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [containerRef],
  );

  const beginDrag = useCallback(
    (e: React.MouseEvent, mode: DragMode, handle?: ResizeHandle) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getMousePos(e.nativeEvent);
      sessionRef.current = {
        mode,
        handle: handle ?? null,
        startPos: pos,
        startPlacement: constrainedPlacement,
      };
      setDragMode(mode);

      const onMove = (ev: MouseEvent) => {
        const session = sessionRef.current;
        if (!session) return;
        const cur = getMousePos(ev);
        const deltaXPx = cur.x - session.startPos.x;
        const deltaYPx = cur.y - session.startPos.y;
        const deltaX = deltaXPx / imageWidth;
        const deltaY = deltaYPx / imageHeight;

        let next: Placement;
        if (session.mode === "move") {
          next = {
            ...session.startPlacement,
            x: session.startPlacement.x + deltaX,
            y: session.startPlacement.y + deltaY,
          };
        } else if (session.handle) {
          next = resizeFromHandle(
            session.handle,
            session.startPlacement,
            deltaXPx,
            deltaYPx,
            imageWidth,
            imageHeight,
          );
        } else {
          return;
        }
        onPlacementChangeRef.current(
          constrainPlacement(next, imageWidth, imageHeight),
        );
      };

      const onUp = () => {
        sessionRef.current = null;
        setDragMode(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [constrainedPlacement, getMousePos, imageWidth, imageHeight],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      beginDrag(e, "resize", handle);
    },
    [beginDrag],
  );

  const x = constrainedPlacement.x * imageWidth;
  const y = constrainedPlacement.y * imageHeight;
  const width = constrainedPlacement.width * imageWidth;
  const height = constrainedPlacement.height * imageHeight;

  return (
    <>
      <div
        className="absolute pointer-events-none"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${height}px`,
          backgroundColor: "var(--primary)",
          opacity: 0.1,
          borderRadius: "4px",
        }}
      />
      <div
        className="absolute pointer-events-auto select-none"
        role="button"
        tabIndex={-1}
        aria-label="Drag to move QR placement"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${height}px`,
          border: "2px solid var(--primary)",
          borderRadius: "4px",
          cursor: dragMode === "move" ? "move" : "default",
        }}
        onMouseDown={(e) => beginDrag(e, "move")}
      >
        <ResizeHandleButton handle="nw" onMouseDown={handleResizeMouseDown} />
        <ResizeHandleButton handle="ne" onMouseDown={handleResizeMouseDown} />
        <ResizeHandleButton handle="sw" onMouseDown={handleResizeMouseDown} />
        <ResizeHandleButton handle="se" onMouseDown={handleResizeMouseDown} />
      </div>
    </>
  );
}
