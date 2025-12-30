import React, { useState, useEffect } from "react";
import { Check, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import confetti from "canvas-confetti";

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

interface GettingStartedChecklistProps {
  onOpenOnboarding: () => void;
  onNavigateToFilters: () => void;
  onViewEvent: () => void;
  profileCompleted?: boolean;
}

const CHECKLIST_STORAGE_KEY = "wat2do_onboarding_checklist";

export function GettingStartedChecklist({
  onOpenOnboarding,
  onNavigateToFilters,
  onViewEvent,
  profileCompleted = false,
}: GettingStartedChecklistProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [items, setItems] = useState<ChecklistItem[]>([
    {
      id: "profile",
      title: "Set up your profile",
      description: "Tell us about your school and interests",
      completed: false,
    },
    {
      id: "browse",
      title: "Browse events",
      description: "Explore what's happening on campus",
      completed: false,
    },
    {
      id: "filter",
      title: "Try filtering",
      description: "Find events that match your interests",
      completed: false,
    },
    {
      id: "view",
      title: "View an event",
      description: "Check out event details",
      completed: false,
    },
  ]);

  // Load state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.items) {
        setItems(parsed.items);
      }
    }
  }, []);

  // Update profile completion when prop changes
  useEffect(() => {
    if (profileCompleted) {
      setItems((prev) => {
        const wasAlreadyComplete = prev.find((i) => i.id === "profile")?.completed;
        if (wasAlreadyComplete) return prev;

        const newItems = prev.map((item) =>
          item.id === "profile" ? { ...item, completed: true } : item
        );

        // Fire confetti for completing profile
        confetti({
          particleCount: 15,
          spread: 50,
          origin: { y: 0.8, x: 0.9 },
          colors: ['#3B82F6', '#60A5FA'],
        });

        return newItems;
      });
    }
  }, [profileCompleted]);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify({ items }));
  }, [items]);

  // Auto-dismiss after all completed with delay
  const completedCount = items.filter((i) => i.completed).length;
  const progress = (completedCount / items.length) * 100;
  const allCompleted = completedCount === items.length;

  // Auto-hide 3 seconds after all completed
  useEffect(() => {
    if (allCompleted) {
      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.8, x: 0.9 },
        colors: ['#3B82F6', '#60A5FA', '#10B981', '#F59E0B'],
      });

      const timer = setTimeout(() => {
        // Clear from localStorage when fully complete
        localStorage.removeItem(CHECKLIST_STORAGE_KEY);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [allCompleted]);

  const completeItem = (id: string) => {
    setItems((prev) => {
      const newItems = prev.map((item) =>
        item.id === id ? { ...item, completed: true } : item
      );

      // Small confetti burst for individual item
      confetti({
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
  const saved = localStorage.getItem(CHECKLIST_STORAGE_KEY);
  if (!saved && allCompleted) {
    return null;
  }

  // Hide completely after all done
  if (allCompleted) {
    return (
      <div
        className="fixed bottom-6 right-6 z-50 rounded-xl overflow-hidden transition-all duration-500 opacity-0 translate-y-4"
        style={{
          width: "320px",
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          animation: "fadeOutDown 0.5s ease-out 2.5s forwards",
        }}
      >
        <div
          className="p-4"
          style={{ backgroundColor: "#10B981" }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-white" />
            <span className="text-white font-semibold text-sm">All done!</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-50 rounded-xl overflow-hidden transition-all duration-300"
      style={{
        width: isExpanded ? "320px" : "200px",
        backgroundColor: "#fff",
        border: "1px solid #e5e7eb",
      }}
    >
      {/* Header */}
      <div
        className="p-4 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ backgroundColor: "#3B82F6" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-white/50 flex items-center justify-center">
              <span className="text-white text-xs font-bold">{completedCount}</span>
            </div>
            <span className="text-white font-semibold text-sm">Getting Started</span>
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
            {completedCount} of {items.length} completed
          </p>
        </div>
      </div>

      {/* Checklist items */}
      {isExpanded && (
        <div className="p-3 space-y-1">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => !item.completed && handleItemClick(item.id)}
              disabled={item.completed}
              className={`w-full text-left p-3 rounded-lg transition-all ${
                item.completed
                  ? "bg-gray-50 cursor-default"
                  : "hover:bg-blue-50 cursor-pointer"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center transition-all ${
                    item.completed
                      ? "bg-green-500"
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
                      item.completed ? "text-gray-400 line-through" : "text-gray-900"
                    }`}
                  >
                    {item.title}
                  </p>
                  <p
                    className={`text-xs mt-0.5 ${
                      item.completed ? "text-gray-300" : "text-gray-500"
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
