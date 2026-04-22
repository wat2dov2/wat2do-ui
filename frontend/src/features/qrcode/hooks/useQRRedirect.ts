import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qrCodeId = location.pathname.replace(/^\/qr\//, "").split("/")[0] || null;
  const [message, setMessage] = useState<string>(() => t("common.loading") || "Loading...");

  // Hold `t` in a ref so i18n rehydration doesn't re-run the effect and
  // cause duplicate backend scans / redirect races.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!qrCodeId) {
      navigate(ROUTES.HOME, { replace: true });
      return;
    }

    setMessage(tRef.current("common.loading") || "Loading...");

    fetchQrRedirectFromBackend(qrCodeId)
      .then((result) => {
        if (result === null) {
          navigate(ROUTES.HOME, { replace: true });
          return;
        }
        if ("requires_location" in result && result.requires_location) {
          setMessage(tRef.current("qrCode.gettingLocation") || "Getting location...");
          getGeolocation().then(({ latitude, longitude }) =>
            fetchQrRedirectWithLocation(qrCodeId, latitude, longitude)
              .then((config) => redirectFromConfig(config))
              .catch((err) => {
                console.error("QR redirect failed:", err);
                navigate(ROUTES.HOME, { replace: true });
              })
          );
          return;
        }
        redirectFromConfig(result);
      })
      .catch((err) => {
        console.error("QR redirect failed:", err);
        navigate(ROUTES.HOME, { replace: true });
      });
  }, [qrCodeId, navigate]);

  return { message };
}
