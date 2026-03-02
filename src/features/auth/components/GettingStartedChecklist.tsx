import React, { useState, useEffect, useRef, useMemo, startTransition } from "react";
import { Check, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { useTranslation } from "react-i18next";
import { useOnClickOutside } from "@/shared/hooks/use-on-click-outside";
import {
  loadChecklist,
  saveChecklist,
  removeChecklist,
  hasChecklist,
  type ChecklistItem,
} from "@/features/auth/api/checklist.api";

interface GettingStartedChecklistProps {
  onOpenOnboarding: () => void;
  onNavigateToFilters: () => void;
  onViewEvent: () => void;
  profileCompleted?: boolean;
}

export function GettingStartedChecklist({
  onOpenOnboarding,
  onNavigateToFilters,
  onViewEvent,
  profileCompleted = false,
}: GettingStartedChecklistProps) {
  const { t } = useTranslation();
  const { trigger } = useConfetti();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  
  const defaultItems = useMemo<ChecklistItem[]>(() => [
    {
      id: "profile",
      title: t("checklist.setUpProfile"),
      description: t("checklist.setUpProfileDesc"),
      completed: false,
    },
    {
      id: "browse",
      title: t("checklist.browseEvents"),
      description: t("checklist.browseEventsDesc"),
      completed: false,
    },
    {
      id: "filter",
      title: t("checklist.tryFiltering"),
      description: t("checklist.tryFilteringDesc"),
      completed: false,
    },
    {
      id: "view",
      title: t("checklist.viewEvent"),
      description: t("checklist.viewEventDesc"),
      completed: false,
    },
  ], [t]);
  
  const [items, setItems] = useState<ChecklistItem[]>(defaultItems);
  const hasLoadedRef = useRef(false);
  const prevProfileCompletedRef = useRef(profileCompleted);

  // Load state from checklist API
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    const saved = loadChecklist();
    let mergedItems: ChecklistItem[];
    if (saved && saved.items) {
      mergedItems = defaultItems.map((defaultItem) => {
        const savedItem = saved.items.find((item: ChecklistItem) => item.id === defaultItem.id);
        return savedItem ? { ...defaultItem, completed: savedItem.completed } : defaultItem;
      });
    } else {
      mergedItems = defaultItems;
    }

    if (profileCompleted) {
      mergedItems = mergedItems.map((item) =>
        item.id === "profile" ? { ...item, completed: true } : item
      );
    }

    startTransition(() => {
      setItems(mergedItems);
    });
  }, [defaultItems, profileCompleted]);

  // Update profile completion when prop changes
  useEffect(() => {
    if (profileCompleted && !prevProfileCompletedRef.current) {
      prevProfileCompletedRef.current = profileCompleted;
      startTransition(() => {
        setItems((prev) => {
          const wasAlreadyComplete = prev.find((i) => i.id === "profile")?.completed;
          if (wasAlreadyComplete) return prev;

          const newItems = prev.map((item) =>
            item.id === "profile" ? { ...item, completed: true } : item
          );

          // Fire confetti for completing profile
          trigger({
            particleCount: 15,
            spread: 50,
            origin: { y: 0.8, x: 0.9 },
            colors: ['#3B82F6', '#60A5FA'],
          });

          return newItems;
        });
      });
    }
  }, [profileCompleted, trigger]);

  // Save state via checklist API
  useEffect(() => {
    saveChecklist({ items });
  }, [items]);

  // Auto-dismiss after all completed with delay
  const completedCount = items.filter((i) => i.completed).length;
  const progress = (completedCount / items.length) * 100;
  const allCompleted = completedCount === items.length;

  // Auto-hide 3 seconds after all completed
  useEffect(() => {
    if (allCompleted) {
      trigger({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.8, x: 0.9 },
        colors: ['#3B82F6', '#60A5FA', '#10B981', '#F59E0B'],
      });

      const timer = setTimeout(() => {
        // Clear from checklist API when fully complete
        removeChecklist();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [allCompleted, trigger]);

  useOnClickOutside(containerRef, () => {
    if (isExpanded) {
      setIsExpanded(false);
    }
  });

  const completeItem = (id: string) => {
    setItems((prev) => {
      const newItems = prev.map((item) =>
        item.id === id ? { ...item, completed: true } : item
      );

      // Small confetti burst for individual item
      trigger({
        particleCount: 15,
        spread: 50,
        origin: { y: 0.8, x: 0.9 },
        colors: ['#3B82F6', '#60A5FA'],
      });

      return newItems;
    });
  };

  const handleItemClick = (id: string) => {
    switch (id) {
      case "profile":
        onOpenOnboarding();
        // Don't complete here - wait for onboarding to actually finish
        break;
      case "browse":
        completeItem(id);
        break;
      case "filter":
        onNavigateToFilters();
        completeItem(id);
        break;
      case "view":
        onViewEvent();
        completeItem(id);
        break;
    }
  };

  // Don't render if all completed and dismissed
  if (!hasChecklist() && allCompleted) {
    return null;
  }

  // Hide completely after all done
  if (allCompleted) {
    return (
      <div
        className="fixed bottom-6 right-6 z-50 rounded-xl overflow-hidden transition-all duration-500 opacity-0 translate-y-4 bg-card"
        style={{
          width: "320px",
          animation: "fadeOutDown 0.5s ease-out 2.5s forwards",
        }}
      >
        <div
          className="p-4 bg-success"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-white" />
            <span className="text-white font-semibold text-sm">{t("checklist.allDone")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed bottom-6 right-6 z-50 rounded-xl overflow-hidden transition-all duration-300 bg-card shadow-lg"
      style={{
        width: isExpanded ? "320px" : "200px",
      }}
    >
      {/* Header */}
      <div
        className="p-4 cursor-pointer select-none bg-primary"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-white/50 flex items-center justify-center">
              <span className="text-white text-xs font-bold">{completedCount}</span>
            </div>
            <span className="text-white font-semibold text-sm">{t("checklist.gettingStarted")}</span>
          </div>
          <div className="flex items-center gap-1">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-white/70" />
            ) : (
              <ChevronUp className="w-5 h-5 text-white/70" />
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-1.5 bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-white/80 text-xs mt-1.5">
            {completedCount} {t("common.of")} {items.length} {t("checklist.completed")}
          </p>
        </div>
      </div>

      {/* Checklist items */}
      {isExpanded && (
        <div className="p-3 space-y-1 border-l border-r border-b border-border">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => !item.completed && handleItemClick(item.id)}
              disabled={item.completed}
              className={`w-full text-left p-3 rounded-lg transition-all ${
                item.completed
                  ? "bg-muted cursor-default"
                  : "hover:bg-primary/10 cursor-pointer"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center transition-all ${
                    item.completed
                      ? "bg-success"
                      : "border-2 border-gray-300"
                  }`}
                >
                  {item.completed && (
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      item.completed ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {item.title}
                  </p>
                  <p
                    className={`text-xs mt-0.5 ${
                      item.completed ? "text-muted-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {item.description}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default GettingStartedChecklist;
