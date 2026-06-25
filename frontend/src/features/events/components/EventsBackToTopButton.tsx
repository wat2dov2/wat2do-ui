import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { EVENTS_SCROLL_ROOT_SELECTOR } from "@/features/events/constants";

export function EventsBackToTopButton() {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const scrollRoot = document.querySelector<HTMLElement>(EVENTS_SCROLL_ROOT_SELECTOR);
    if (!scrollRoot) return;

    const syncVisibility = () => {
      setIsVisible(scrollRoot.scrollTop > 400);
    };

    syncVisibility();
    scrollRoot.addEventListener("scroll", syncVisibility, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", syncVisibility);
  }, []);

  const scrollToTop = () => {
    const scrollRoot = document.querySelector<HTMLElement>(EVENTS_SCROLL_ROOT_SELECTOR);
    scrollRoot?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <Button
      type="button"
      size="icon-lg"
      variant="default"
      aria-label={t("events.backToTop")}
      onMouseDown={scrollToTop}
      className={`fixed bottom-8 right-4 z-40 rounded-full shadow-lg transition-all duration-200 ${
        isVisible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <ChevronUp className="size-5" />
    </Button>
  );
}
