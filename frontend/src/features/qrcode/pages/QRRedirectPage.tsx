/**
 * Full-page view for /qr/:qrCodeId. Shows loading UI immediately and handles
 * backend resolve (200 → redirect, 202 → get location and retry, 404 → home).
 * No app chrome so the scan experience is minimal.
 */

import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
import { useTranslation } from "react-i18next";
import {
  fetchQrRedirectFromBackend,
  fetchQrRedirectWithLocation,
  redirectFromConfig,
} from "@/features/qrcode/api/qrcode.api";
import { LoadingPage } from "@/shared/ui/loading-page";

export function QRRedirectPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const qrCodeId = location.pathname.replace(/^\/qr\//, "").split("/")[0] || null;
  const { t } = useTranslation();
  const [message, setMessage] = useState<string>(() => t("common.loading") || "Loading...");

  useEffect(() => {
    if (!qrCodeId) {
      navigate(ROUTES.HOME, { replace: true });
      return;
    }

    setMessage(t("common.loading") || "Loading...");

    fetchQrRedirectFromBackend(qrCodeId)
      .then((result) => {
        if (result === null) {
          navigate(ROUTES.HOME, { replace: true });
          return;
        }
        if ("requires_location" in result && result.requires_location) {
          setMessage(t("qrCode.gettingLocation") || "Getting location...");
          const getLocation = (): Promise<{ latitude: number; longitude: number }> =>
            new Promise((resolve) => {
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
          getLocation().then(({ latitude, longitude }) =>
            fetchQrRedirectWithLocation(qrCodeId, latitude, longitude)
              .then((config) => redirectFromConfig(config))
              .catch((err) => { console.error("QR redirect failed:", err); navigate(ROUTES.HOME, { replace: true }); })
          );
          return;
        }
        redirectFromConfig(result);
      })
      .catch((err) => { console.error("QR redirect failed:", err); navigate(ROUTES.HOME, { replace: true }); });
  }, [qrCodeId, navigate, t]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <LoadingPage label={message} spinnerClassName="size-8" className="py-24" />
    </div>
  );
}
