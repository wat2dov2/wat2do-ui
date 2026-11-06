import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { useTranslation } from "react-i18next";
import { useTicketCheckIn } from "@/features/tickets/hooks/useTickets";
import { formatClock, ticketCodeFrom } from "@/features/tickets/lib/ticketFormat";
import type { ApiTicketCheckInResponse } from "@/shared/generated";
import { FormActions, Stack } from "@/shared/layout";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription } from "@/shared/ui/card";
import { FormInput } from "@/shared/ui/form-field";
import { LoadingButton } from "@/shared/ui/loading-button";
import { AlertTriangle, Camera, CheckCircle2 } from "lucide-react";

// The same ticket held in front of the camera is read once, not once per frame.
const SAME_CODE_COOLDOWN_MS = 4000;
// Decoding every frame drains phone batteries at a long door; a few reads a second is plenty.
const SCAN_INTERVAL_MS = 250;
// One buzz lets them in; three short ones mean look at the screen.
const ADMIT_VIBRATION_MS = [80];
const LOOK_VIBRATION_MS = [60, 60, 60, 60, 60];

type CameraState = "starting" | "scanning" | "stopped" | "blocked";

/** A phone at the door: each QR code scanned checks its ticket in, with a glance at the result. */
export function DoorScanner({ eventId }: { eventId: number }) {
  const { t, i18n } = useTranslation();
  const checkIn = useTicketCheckIn(eventId, { showsResults: true });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  // The camera starts with the page: at a door, every tap counts.
  const [camera, setCamera] = useState<CameraState>("starting");
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<ApiTicketCheckInResponse | null>(null);
  const { mutate } = checkIn;

  const admit = useCallback(
    (scanned: string) => {
      const code = ticketCodeFrom(scanned);
      if (!code) return;
      const now = Date.now();
      if (lastCode.current?.code === code && now - lastCode.current.at < SAME_CODE_COOLDOWN_MS) return;
      lastCode.current = { code, at: now };
      mutate(
        { code, checkedIn: true },
        {
          onSuccess: (response) => {
            setResult(response);
            navigator.vibrate?.(
              response.result === "checked_in" ? ADMIT_VIBRATION_MS : LOOK_VIBRATION_MS,
            );
          },
        },
      );
    },
    [mutate],
  );

  // The scan loop outlives renders, so it reads the latest admit through a ref.
  const admitRef = useRef(admit);
  useEffect(() => {
    admitRef.current = admit;
  }, [admit]);

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
      if (decoded?.data) admitRef.current(decoded.data);
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

  const resultTone = !result
    ? null
    : result.result === "checked_in"
      ? "success"
      : result.result === "already_checked_in" || result.result === "undone"
        ? "warning"
        : "destructive";

  return (
    <Stack gap={4}>
      <Card>
        <CardContent>
          <Stack gap={3} align="center">
            {/* The camera's viewport: square, so a held-up phone screen fills it. */}
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label={t("tickets.scanner.cameraLabel")}
              hidden={camera !== "scanning"}
              className="aspect-square w-full max-w-sm rounded-xl bg-muted object-cover"
            />
            {camera === "scanning" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setCamera("stopped")}>
                {t("tickets.scanner.stopCamera")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => setCamera("starting")}
                disabled={camera === "starting"}
              >
                <Camera className="size-4" />
                {t("tickets.scanner.startCamera")}
              </Button>
            )}
            {camera === "blocked" ? (
              <CardDescription>{t("tickets.scanner.cameraBlocked")}</CardDescription>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      {result && resultTone ? (
        <Alert variant={resultTone} aria-live="assertive">
          {resultTone === "success" ? <CheckCircle2 /> : <AlertTriangle />}
          <AlertTitle>{t(`tickets.door.results.${result.result}`)}</AlertTitle>
          {result.attendee ? (
            <AlertDescription>
              {result.attendee.holder_name}
              {result.result === "already_checked_in" && result.attendee.checked_in_at
                ? ` · ${t("tickets.door.checkedInAt", {
                    time: formatClock(result.attendee.checked_in_at, i18n.language),
                  })}`
                : ""}
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          lastCode.current = null;
          admit(manualCode);
          setManualCode("");
        }}
      >
        <Stack gap={2}>
          <FormInput
            name={`door-code-${eventId}`}
            label={t("tickets.scanner.manual")}
            placeholder={t("tickets.scanner.manualPlaceholder")}
            value={manualCode}
            onChange={(value) => setManualCode(String(value))}
          />
          <FormActions align="start">
            <LoadingButton type="submit" isLoading={checkIn.isPending} disabled={!manualCode.trim()}>
              {t("tickets.door.checkIn")}
            </LoadingButton>
          </FormActions>
        </Stack>
      </form>
    </Stack>
  );
}
