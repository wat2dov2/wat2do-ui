export function initGoogleAnalytics(measurementId: string | undefined) {
  if (!measurementId || import.meta.env.DEV) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if ((window as unknown as { gtag?: unknown }).gtag) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);

  const analyticsWindow = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.gtag = (...args: unknown[]) => {
    analyticsWindow.dataLayer?.push(args);
  };
  analyticsWindow.gtag("js", new Date());
  analyticsWindow.gtag("config", measurementId);
}
