import React, { useCallback, useEffect, useMemo, useState } from "react";

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

type ResizeHandle = "nw" | "ne" | "sw" | "se" | null;
type DragMode = "move" | "resize" | null;

export function QRPlacementOverlay({
  placement,
  onPlacementChange,
  containerRef,
  imageWidth,
  imageHeight,
}: QRPlacementOverlayProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle>(null);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [startPlacement, setStartPlacement] = useState<Placement>(placement);

  const minSize = 0.05; // Minimum 5% of container size

  // Constrain placement within bounds and maintain square aspect ratio in pixel space
  const constrainPlacement = useCallback(
    (p: Placement): Placement => {
      let { x, y, width, height } = p;

      // Convert to pixel dimensions
      const widthPx = width * imageWidth;
      const heightPx = height * imageHeight;

      // Ensure square aspect ratio in pixel space - use the smaller pixel dimension
      const sizePx = Math.min(widthPx, heightPx);

      // Convert back to normalized coordinates
      width = sizePx / imageWidth;
      height = sizePx / imageHeight;

      // Ensure minimum size (in normalized coordinates)
      const minSizePx = minSize * Math.min(imageWidth, imageHeight);
      const minSizeNormalized = minSizePx / Math.min(imageWidth, imageHeight);
      width = Math.max(minSizeNormalized, width);
      height = Math.max(minSizeNormalized, height);

      // Constrain width/height to fit within bounds
      width = Math.min(width, 1);
      height = Math.min(height, 1);

      // Constrain position
      x = Math.max(0, Math.min(x, 1 - width));
      y = Math.max(0, Math.min(y, 1 - height));

      return { x, y, width, height };
    },
    [minSize, imageWidth, imageHeight]
  );

  // Constrain the placement prop whenever it changes to ensure it's always square
  const constrainedPlacement = useMemo(
    () => constrainPlacement(placement),
    [placement, constrainPlacement]
  );

  // Update parent if placement needs to be constrained (only when not dragging)
  useEffect(() => {
    if (!isDragging) {
      if (
        constrainedPlacement.width !== placement.width ||
        constrainedPlacement.height !== placement.height ||
        constrainedPlacement.x !== placement.x ||
        constrainedPlacement.y !== placement.y
      ) {
        onPlacementChange(constrainedPlacement);
      }
    }
  }, [constrainedPlacement, placement, onPlacementChange, isDragging]);

  // Convert normalized coordinates (0-1) to pixel coordinates
  const toPixels = useCallback(
    (normalized: number, dimension: "width" | "height") => {
      return normalized * (dimension === "width" ? imageWidth : imageHeight);
    },
    [imageWidth, imageHeight]
  );

  // Convert pixel coordinates to normalized (0-1)
  const toNormalized = useCallback(
    (pixels: number, dimension: "width" | "height") => {
      const max = dimension === "width" ? imageWidth : imageHeight;
      return max > 0 ? pixels / max : 0;
    },
    [imageWidth, imageHeight]
  );

  const getMousePos = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [containerRef]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, mode: DragMode, handle?: ResizeHandle) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getMousePos(e.nativeEvent);
      setIsDragging(true);
      setDragMode(mode);
      setResizeHandle(handle || null);
      setStartPos(pos);
      setStartPlacement(constrainedPlacement);
    },
    [getMousePos, constrainedPlacement]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !dragMode) return;

      const currentPos = getMousePos(e);
      const deltaX = toNormalized(currentPos.x - startPos.x, "width");
      const deltaY = toNormalized(currentPos.y - startPos.y, "height");

      let newPlacement: Placement;

      if (dragMode === "move") {
        newPlacement = {
          ...startPlacement,
          x: startPlacement.x + deltaX,
          y: startPlacement.y + deltaY,
        };
      } else if (dragMode === "resize" && resizeHandle) {
        const { x: startX, y: startY, width: startW, height: startH } =
          startPlacement;

        // Convert start placement to pixel space
        const startXPx = startX * imageWidth;
        const startYPx = startY * imageHeight;
        const startWidthPx = startW * imageWidth;
        const startHeightPx = startH * imageHeight;
        
        // The square size in pixels (should be the same for width and height)
        const startSizePx = Math.min(startWidthPx, startHeightPx);
        
        // Convert deltas to pixel space
        const deltaXPx = deltaX * imageWidth;
        const deltaYPx = deltaY * imageHeight;
        
        // Calculate the distance moved in pixel space
        // Use the larger absolute delta to determine size change
        const absDeltaXPx = Math.abs(deltaXPx);
        const absDeltaYPx = Math.abs(deltaYPx);
        const sizeDeltaPx = Math.max(absDeltaXPx, absDeltaYPx);
        
        // Determine the sign based on which corner is being dragged
        let sizeChangePx = 0;

        switch (resizeHandle) {
          case "nw": {
            // Northwest: dragging left/up increases size
            sizeChangePx = deltaXPx < 0 || deltaYPx < 0 ? sizeDeltaPx : -sizeDeltaPx;
            const newSizePx = startSizePx + sizeChangePx;
            const newXPx = startXPx - sizeChangePx;
            const newYPx = startYPx - sizeChangePx;
            newPlacement = {
              x: newXPx / imageWidth,
              y: newYPx / imageHeight,
              width: newSizePx / imageWidth,
              height: newSizePx / imageHeight,
            };
            break;
          }
          case "ne": {
            // Northeast: dragging right/up increases size
            sizeChangePx = deltaXPx > 0 || deltaYPx < 0 ? sizeDeltaPx : -sizeDeltaPx;
            const newSizePx = startSizePx + sizeChangePx;
            const newYPx = startYPx - sizeChangePx;
            newPlacement = {
              x: startXPx / imageWidth,
              y: newYPx / imageHeight,
              width: newSizePx / imageWidth,
              height: newSizePx / imageHeight,
            };
            break;
          }
          case "sw": {
            // Southwest: dragging left/down increases size
            sizeChangePx = deltaXPx < 0 || deltaYPx > 0 ? sizeDeltaPx : -sizeDeltaPx;
            const newSizePx = startSizePx + sizeChangePx;
            const newXPx = startXPx - sizeChangePx;
            newPlacement = {
              x: newXPx / imageWidth,
              y: startYPx / imageHeight,
              width: newSizePx / imageWidth,
              height: newSizePx / imageHeight,
            };
            break;
          }
          case "se": {
            // Southeast: dragging right/down increases size
            sizeChangePx = deltaXPx > 0 || deltaYPx > 0 ? sizeDeltaPx : -sizeDeltaPx;
            const newSizePx = startSizePx + sizeChangePx;
            newPlacement = {
              x: startXPx / imageWidth,
              y: startYPx / imageHeight,
              width: newSizePx / imageWidth,
              height: newSizePx / imageHeight,
            };
            break;
          }
          default:
            newPlacement = startPlacement;
        }
      } else {
        return;
      }

      const constrained = constrainPlacement(newPlacement);
      onPlacementChange(constrained);
    },
    [
      isDragging,
      dragMode,
      resizeHandle,
      startPos,
      startPlacement,
      getMousePos,
      toNormalized,
      constrainPlacement,
      onPlacementChange,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragMode(null);
    setResizeHandle(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleSize = 8;
  const x = toPixels(constrainedPlacement.x, "width");
  const y = toPixels(constrainedPlacement.y, "height");
  const width = toPixels(constrainedPlacement.width, "width");
  const height = toPixels(constrainedPlacement.height, "height");

  const handleStyle: React.CSSProperties = {
    width: `${handleSize}px`,
    height: `${handleSize}px`,
    backgroundColor: "var(--primary)",
    border: "2px solid white",
    borderRadius: "2px",
    position: "absolute",
    cursor: "pointer",
    zIndex: 10,
  };

  const getHandleCursor = (handle: ResizeHandle) => {
    switch (handle) {
      case "nw":
        return "nw-resize";
      case "ne":
        return "ne-resize";
      case "sw":
        return "sw-resize";
      case "se":
        return "se-resize";
      default:
        return "default";
    }
  };

  return (
    <>
      {/* Background overlay with opacity */}
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
      {/* Border and interactive area */}
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
        onMouseDown={(e) => handleMouseDown(e, "move")}
      >
      {/* Resize handles */}
      {/* Northwest */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Resize from northwest corner"
        style={{
          ...handleStyle,
          left: `-${handleSize / 2}px`,
          top: `-${handleSize / 2}px`,
          cursor: getHandleCursor("nw"),
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          handleMouseDown(e, "resize", "nw");
        }}
      />
      {/* Northeast */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Resize from northeast corner"
        style={{
          ...handleStyle,
          right: `-${handleSize / 2}px`,
          top: `-${handleSize / 2}px`,
          cursor: getHandleCursor("ne"),
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          handleMouseDown(e, "resize", "ne");
        }}
      />
      {/* Southwest */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Resize from southwest corner"
        style={{
          ...handleStyle,
          left: `-${handleSize / 2}px`,
          bottom: `-${handleSize / 2}px`,
          cursor: getHandleCursor("sw"),
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          handleMouseDown(e, "resize", "sw");
        }}
      />
      {/* Southeast */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Resize from southeast corner"
        style={{
          ...handleStyle,
          right: `-${handleSize / 2}px`,
          bottom: `-${handleSize / 2}px`,
          cursor: getHandleCursor("se"),
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          handleMouseDown(e, "resize", "se");
        }}
      />
      </div>
    </>
  );
}
