import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";

/**
 * Scroll-to-top control for AppLayout's main content scroller.
 * Positioned by AppLayout on the same baseline as FloatingDock icons.
 */
export function BackToTopButton() {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const scrollRoot = document.querySelector<HTMLElement>(MAIN_CONTENT_SCROLL_ROOT_SELECTOR);
    if (!scrollRoot) return;

    const syncVisibility = () => {
      setIsVisible(scrollRoot.scrollTop > 400);
    };

    syncVisibility();
    scrollRoot.addEventListener("scroll", syncVisibility, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", syncVisibility);
  }, []);

  const scrollToTop = () => {
    const scrollRoot = document.querySelector<HTMLElement>(MAIN_CONTENT_SCROLL_ROOT_SELECTOR);
    scrollRoot?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <Button
      type="button"
      size="icon"
      variant="primary"
      aria-label={t("common.backToTop")}
      onMouseDown={scrollToTop}
      className={`rounded-full shadow-lg transition-all duration-200 ${
        isVisible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <ChevronUp className="size-[18px]" />
    </Button>
  );
}
