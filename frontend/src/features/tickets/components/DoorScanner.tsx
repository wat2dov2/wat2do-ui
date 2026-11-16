import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDoorCamera, type DoorCameraState } from "@/features/tickets/hooks/useDoorCamera";
import { useTicketCheckIn } from "@/features/tickets/hooks/useTickets";
import { formatClock, ticketCodeFrom } from "@/features/tickets/lib/ticketFormat";
import type { ApiTicketCheckInResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { FormInput } from "@/shared/ui/form-field";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Spinner } from "@/shared/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { AlertTriangle, Camera, CameraOff, CheckCircle2, ChevronDown, Keyboard, Users, X, XCircle } from "lucide-react";

// The same ticket held in front of the camera is read once, not once per frame.
const SAME_CODE_COOLDOWN_MS = 4000;
// One buzz lets them in; three short ones mean look at the screen.
const ADMIT_VIBRATION_MS = [80];
const LOOK_VIBRATION_MS = [60, 60, 60, 60, 60];
// A ticket let in clears quickly for the next person; anything else stays up long enough to read.
const ADMITTED_RESULT_MS = 2500;
const LOOK_RESULT_MS = 6000;

type ResultTone = "admit" | "look" | "refuse";

function resultTone(result: ApiTicketCheckInResponse["result"]): ResultTone {
  if (result === "checked_in") return "admit";
  if (result === "already_checked_in" || result === "undone") return "look";
  return "refuse";
}

const TONE_STYLES: Record<ResultTone, { panel: string; disc: string; icon: typeof CheckCircle2 }> = {
  admit: { panel: "border-success bg-success/15", disc: "bg-success text-success-foreground", icon: CheckCircle2 },
  look: { panel: "border-warning bg-warning/15", disc: "bg-warning text-warning-foreground", icon: AlertTriangle },
  refuse: {
    panel: "border-destructive bg-destructive/15",
    disc: "bg-destructive text-destructive-foreground",
    icon: XCircle,
  },
};

/** The checked-in count on the event so far, when the desk has loaded. */
interface DoorCounts {
  checkedIn: number;
  issued: number;
}

/**
 * A phone at the door: the camera fills the screen, each QR code it reads
 * checks its ticket in, and the result covers the camera until it clears for
 * the next person. Typing a code is a fallback tucked under the camera.
 */
export function DoorScanner({ eventId, counts }: { eventId: number; counts?: DoorCounts }) {
  const { t } = useTranslation();
  const checkIn = useTicketCheckIn(eventId, { showsResults: true });
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const [result, setResult] = useState<ApiTicketCheckInResponse | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
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

  // While a result covers the camera, the camera reads nothing: the door sees every result.
  const scan = useCallback(
    (scanned: string) => {
      if (!result) admit(scanned);
    },
    [admit, result],
  );
  const { videoRef, camera, start, stop } = useDoorCamera(scan);

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(
      () => setResult(null),
      result.result === "checked_in" ? ADMITTED_RESULT_MS : LOOK_RESULT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [result]);

  return (
    <Stack gap={4} data-content-width="sm">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted sm:aspect-[4/3]">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={t("tickets.scanner.cameraLabel")}
          hidden={camera !== "scanning"}
          className="size-full object-cover"
        />
        {camera === "scanning" ? <ScanFrame /> : <CameraIdle camera={camera} onStart={start} />}

        {counts ? (
          <p className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-background/85 px-3 py-1.5 text-sm font-medium tabular-nums text-foreground shadow-sm backdrop-blur">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            {t("tickets.scanner.admitted", { checkedIn: counts.checkedIn, issued: counts.issued })}
          </p>
        ) : null}
        {camera === "scanning" ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            // Pinned to the camera's corner.
            className="absolute top-3 right-3"
            aria-label={t("tickets.scanner.stopCamera")}
            onClick={stop}
          >
            <CameraOff />
          </Button>
        ) : null}
        {checkIn.isPending && !result ? (
          <Spinner className="absolute bottom-4 left-1/2 size-6 -translate-x-1/2 text-primary" />
        ) : null}

        {result ? <ScanResult result={result} onDismiss={() => setResult(null)} /> : null}
      </div>

      <Stack gap={3} align="center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={manualOpen || camera === "blocked"}
          onClick={() => setManualOpen((open) => !open)}
        >
          <Keyboard />
          {t("tickets.scanner.manualToggle")}
          <ChevronDown className={cn("transition-transform", (manualOpen || camera === "blocked") && "rotate-180")} />
        </Button>
        {manualOpen || camera === "blocked" ? (
          <form
            className="w-full"
            onSubmit={(event) => {
              event.preventDefault();
              lastCode.current = null;
              admit(manualCode);
              setManualCode("");
            }}
          >
            <Stack direction="horizontal" gap={2} align="end">
              <FormInput
                name={`door-code-${eventId}`}
                label={t("tickets.scanner.manual")}
                placeholder={t("tickets.scanner.manualPlaceholder")}
                value={manualCode}
                onChange={(value) => setManualCode(String(value))}
                // Fills the row beside its button.
                className="min-w-0 flex-1"
              />
              <LoadingButton type="submit" isLoading={checkIn.isPending} disabled={!manualCode.trim()}>
                {t("tickets.door.checkIn")}
              </LoadingButton>
            </Stack>
          </form>
        ) : null}
      </Stack>
    </Stack>
  );
}

/** Corner brackets that show where to hold the ticket. */
function ScanFrame() {
  const corner = "absolute size-10 border-primary";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-[15%]">
      <span className={cn(corner, "top-0 left-0 rounded-tl-2xl border-t-4 border-l-4")} />
      <span className={cn(corner, "top-0 right-0 rounded-tr-2xl border-t-4 border-r-4")} />
      <span className={cn(corner, "bottom-0 left-0 rounded-bl-2xl border-b-4 border-l-4")} />
      <span className={cn(corner, "right-0 bottom-0 rounded-br-2xl border-r-4 border-b-4")} />
    </div>
  );
}

/** The camera's square while it is off, starting or not allowed. */
function CameraIdle({ camera, onStart }: { camera: DoorCameraState; onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <Stack gap={3} align="center" justify="center" className="absolute inset-0 p-6 text-center">
      {camera === "starting" ? (
        <>
          <Spinner className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("tickets.scanner.cameraStarting")}</p>
        </>
      ) : (
        <>
          {camera === "blocked" ? (
            <p className="max-w-xs text-sm text-muted-foreground">{t("tickets.scanner.cameraBlocked")}</p>
          ) : null}
          <Button type="button" size="lg" onClick={onStart}>
            <Camera />
            {t("tickets.scanner.startCamera")}
          </Button>
        </>
      )}
    </Stack>
  );
}

/** One scan's result, over the camera: green lets them in, amber means look, red turns them away. */
function ScanResult({ result, onDismiss }: { result: ApiTicketCheckInResponse; onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const tone = TONE_STYLES[resultTone(result.result)];
  const Icon = tone.icon;
  const checkedInAt =
    result.result === "already_checked_in" && result.attendee?.checked_in_at
      ? t("tickets.door.checkedInAt", { time: formatClock(result.attendee.checked_in_at, i18n.language) })
      : null;
  return (
    // An alert, so a screen reader says each result as it appears.
    <div role="alert" className="absolute inset-0">
    <button
      type="button"
      onClick={onDismiss}
      className="size-full cursor-pointer rounded-2xl bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
    >
      <Stack
        gap={3}
        align="center"
        justify="center"
        className={cn("size-full rounded-2xl border-4 p-6 text-center", tone.panel)}
      >
        <span className={cn("flex size-20 items-center justify-center rounded-full", tone.disc)}>
          <Icon className="size-11" aria-hidden />
        </span>
        <span className="text-2xl font-bold text-balance text-foreground">
          {t(`tickets.door.results.${result.result}`)}
        </span>
        {result.attendee ? (
          <span className="text-lg font-medium text-foreground">{result.attendee.holder_name}</span>
        ) : null}
        {checkedInAt ? <span className="text-sm text-muted-foreground">{checkedInAt}</span> : null}
        <span className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
          <X className="size-4" aria-hidden />
          {t("tickets.scanner.scanNext")}
        </span>
      </Stack>
    </button>
    </div>
  );
}
