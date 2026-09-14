import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/shared/constants/routes";
import {
  fetchQrRedirectFromBackend,
  fetchQrRedirectWithLocation,
  redirectFromConfig,
} from "@/features/qrcode/api/qrcode.api";

function getGeolocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ latitude: 0, longitude: 0 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      () => resolve({ latitude: 0, longitude: 0 }),
      { timeout: 5000, maximumAge: 60000 }
    );
  });
}

/**
 * Encapsulates the QR redirect flow: parse the QR code ID from the URL,
 * call the backend to resolve redirect config, handle location-required
 * responses, and perform the redirect.
 *
 * Returns only the loading message for the page to render.
 */
export function useQRRedirect(): { message: string } {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const qrCodeId = pathname.replace(/^\/qr\//, "").split("/")[0] || null;
  const [message, setMessage] = useState<string>(() => t("common.loading"));

  // Hold `t` in a ref so i18n rehydration doesn't re-run the effect and
  // cause duplicate backend scans / redirect races.
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!qrCodeId) {
      router.replace(ROUTES.HOME);
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setMessage(tRef.current("common.loading"));
    });

    fetchQrRedirectFromBackend(qrCodeId)
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          router.replace(ROUTES.HOME);
          return;
        }
        if ("requires_location" in result && result.requires_location) {
          setMessage(tRef.current("qrCode.gettingLocation"));
          getGeolocation().then(({ latitude, longitude }) =>
            fetchQrRedirectWithLocation(qrCodeId, latitude, longitude)
              .then((config) => {
                if (!cancelled) redirectFromConfig(config);
              })
              .catch((err) => {
                console.error("QR redirect failed:", err);
                if (!cancelled) router.replace(ROUTES.HOME);
              })
          );
          return;
        }
        // TypeScript can't narrow QrRedirectResult after the
        // ``"requires_location" in result && result.requires_location``
        // check (the && chains a property read after the ``in`` guard).
        // Cast since by control flow we've established this is the
        // ``QrRedirectConfig`` branch.
        redirectFromConfig(result as Parameters<typeof redirectFromConfig>[0]);
      })
      .catch((err) => {
        console.error("QR redirect failed:", err);
        if (!cancelled) router.replace(ROUTES.HOME);
      });
    return () => {
      cancelled = true;
    };
  }, [qrCodeId, router]);

  return { message };
}
