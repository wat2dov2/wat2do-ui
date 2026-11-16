import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Decoding every frame drains phone batteries at a long door; a few reads a second is plenty.
const SCAN_INTERVAL_MS = 250;

export type DoorCameraState = "starting" | "scanning" | "stopped" | "blocked";

/**
 * The phone's back camera, reading QR codes into `onCode` a few times a
 * second. It starts with the page: at a door, every tap counts.
 */
export function useDoorCamera(onCode: (scanned: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [camera, setCamera] = useState<DoorCameraState>("starting");

  // The scan loop outlives renders, so it reads the latest callback through a ref.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  // One camera session from "starting" through "scanning": keying the effect on
  // the state itself would stop the stream the moment it switched to scanning.
  const cameraOn = camera === "starting" || camera === "scanning";

  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    const scanFrame = () => {
      const video = videoRef.current;
      if (cancelled || !video || video.readyState < video.HAVE_ENOUGH_DATA) return;
      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
      if (decoded?.data) onCodeRef.current(decoded.data);
    };

    // Browsers without camera access (or off HTTPS) go straight to typing codes.
    const media = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      : Promise.reject(new Error("No camera"));
    media
      .then(async (opened) => {
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = opened;
        await video.play();
        setCamera("scanning");
        timer = window.setInterval(scanFrame, SCAN_INTERVAL_MS);
      })
      .catch(() => setCamera("blocked"));

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOn]);

  return {
    videoRef,
    camera,
    start: () => setCamera("starting"),
    stop: () => setCamera("stopped"),
  };
}
