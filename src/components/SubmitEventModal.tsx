import React, { useState, useEffect, useCallback, Suspense, lazy, useMemo } from "react";
import { Calendar, MapPin, DollarSign, Users, Utensils, Plus, ImagePlus, Check, Sparkles, X, Eye, Megaphone, ChevronRight, Coins } from "lucide-react";
import confetti from "canvas-confetti";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BadgeMask } from "@/components/ui/badge-mask";
import { availableCategories, availableLocations } from "@/data/events";
import { generateEventWithAI } from "@/lib/openai";
import { PROMOTION_PACKAGES } from "@/types";

// Lazy load Monaco Editor
const Editor = lazy(() => import("@monaco-editor/react"));

interface SubmitEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => number; // Returns the created event's ID
  userCredits?: number;
  onPromote?: (eventId: number, packageId: string, credits: number, duration: number) => boolean;
  onBuyCredits?: () => void;
  editEventId?: number; // Event ID being edited
  initialData?: EventFormData; // Initial data for edit mode
  onUpdate?: (eventId: number, event: EventFormData) => void; // Update handler for edit mode
}

interface EventFormData {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  category: string;
  price: number;
  food: string[];
  requiresRegistration: boolean;
  organization: string;
}

interface ValidationErrors {
  title?: string;
  organization?: string;
  date?: string;
  time?: string;
  location?: string;
}

type ViewMode = "visual" | "json";

// Category color mapping - returns Tailwind classes using tokens
const getCategoryClasses = (category: string): { bg: string; text: string } => {
  const mapping: Record<string, { bg: string; text: string }> = {
    "Events": { bg: "bg-category-events-bg", text: "text-category-events-text" },
    "Clubs": { bg: "bg-category-clubs-bg", text: "text-category-clubs-text" },
    "Academic": { bg: "bg-category-academic-bg", text: "text-category-academic-text" },
    "Religious": { bg: "bg-category-religious-bg", text: "text-category-religious-text" },
    "Cultural": { bg: "bg-category-cultural-bg", text: "text-category-cultural-text" },
    "Social & Games": { bg: "bg-category-social-bg", text: "text-category-social-text" },
    "Sports & Fitness": { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    "Career": { bg: "bg-category-career-bg", text: "text-category-career-text" },
    "Technology": { bg: "bg-category-technology-bg", text: "text-category-technology-text" },
    "Arts & Crafts": { bg: "bg-category-arts-bg", text: "text-category-arts-text" },
    "Health & Wellness": { bg: "bg-category-health-bg", text: "text-category-health-text" },
    "Music & Performance": { bg: "bg-category-music-bg", text: "text-category-music-text" },
    "Entrepreneurship": { bg: "bg-category-entrepreneurship-bg", text: "text-category-entrepreneurship-text" },
  };
  return mapping[category] || { bg: "bg-category-default-bg", text: "text-category-default-text" };
};

export function SubmitEventModal({
  isOpen,
  onClose,
  onSubmit,
  userCredits = 0,
  onPromote,
  onBuyCredits,
  editEventId,
  initialData,
  onUpdate,
}: SubmitEventModalProps) {
  const isEditMode = !!editEventId && !!initialData;
  // Detect dark mode from document class
  const [isDarkMode, setIsDarkMode] = useState(() => 
    document.documentElement.classList.contains('dark')
  );
  
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>("visual");

  // Promotion state
  const [selectedPromotion, setSelectedPromotion] = useState<string | null>(null);
  const [promotionSuccess, setPromotionSuccess] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<number | null>(null);

  // Smart defaults: today's date, current time rounded to next hour
  const getSmartDefaults = () => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
    const time = `${nextHour.getHours().toString().padStart(2, "0")}:00`;
    return { date: today, time };
  };

  const smartDefaults = getSmartDefaults();

  const [formData, setFormData] = useState<EventFormData>({
    title: "",
    description: "",
    date: smartDefaults.date,
    time: smartDefaults.time,
    location: "",
    category: "",
    price: 0,
    food: [],
    requiresRegistration: false,
    organization: "",
  });
  const [foodInput, setFoodInput] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showPromotion, setShowPromotion] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // JSON Editor state
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState("");

  // AI state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Sync formData to JSON when switching to JSON view
  useEffect(() => {
    if (viewMode === "json") {
      setJsonValue(JSON.stringify(formData, null, 2));
    }
  }, [viewMode]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsSubmitted(false);
      setShowPromotion(false);
      setViewMode("visual");
      setSelectedPromotion(null);
      setPromotionSuccess(false);
      setCreatedEventId(null);
      const defaults = getSmartDefaults();
      
      // Pre-fill form if in edit mode
      if (isEditMode && initialData) {
        setFormData(initialData);
      } else {
        setFormData({
          title: "",
          description: "",
          date: defaults.date,
          time: defaults.time,
          location: "",
          category: "",
          price: 0,
          food: [],
          requiresRegistration: false,
          organization: "",
        });
      }
      
      setErrors({});
      setTouched({});
      setJsonValue("");
      setJsonError("");
      setAiPrompt("");
    }
  }, [isOpen, isEditMode, initialData]);

  // Fire confetti on success
  useEffect(() => {
    if (isSubmitted && !showPromotion) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#3B82F6', '#60A5FA', '#10B981', '#F59E0B'],
      });
    }
  }, [isSubmitted, showPromotion]);

  // Validate on change
  useEffect(() => {
    const newErrors: ValidationErrors = {};
    if (touched.title && !formData.title.trim()) {
      newErrors.title = "Title is required";
    }
    if (touched.organization && !formData.organization.trim()) {
      newErrors.organization = "Organization is required";
    }
    if (touched.date && !formData.date) {
      newErrors.date = "Date is required";
    }
    if (touched.time && !formData.time) {
      newErrors.time = "Time is required";
    }
    if (touched.location && !formData.location) {
      newErrors.location = "Location is required";
    }
    setErrors(newErrors);
  }, [formData, touched]);

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  const handleSubmit = () => {
    // Mark all required fields as touched
    setTouched({
      title: true,
      organization: true,
      date: true,
      time: true,
      location: true,
    });

    // Check if form is valid
    if (!formData.title.trim() || !formData.organization.trim() || !formData.date || !formData.time || !formData.location) {
      return;
    }

    // If in edit mode, update the event
    if (isEditMode && editEventId && onUpdate) {
      onUpdate(editEventId, formData);
      onClose();
      return;
    }

    // Otherwise, create new event
    const eventId = onSubmit(formData);
    setCreatedEventId(eventId);
    setIsSubmitted(true);
  };

  // Handle promotion purchase
  const handlePromote = () => {
    if (!selectedPromotion || !createdEventId || !onPromote) return;

    const pkg = PROMOTION_PACKAGES.find(p => p.id === selectedPromotion);
    if (!pkg) return;

    const success = onPromote(createdEventId, pkg.id, pkg.credits, pkg.duration);
    if (success) {
      setPromotionSuccess(true);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#A855F7", "#EC4899", "#8B5CF6", "#F59E0B"],
      });
    }
  };

  const handleClose = () => {
    onClose();
  };

  const addFood = () => {
    if (foodInput.trim()) {
      setFormData(prev => ({
        ...prev,
        food: [...prev.food, foodInput.trim()]
      }));
      setFoodInput("");
    }
  };

  const removeFood = (index: number) => {
    setFormData(prev => ({
      ...prev,
      food: prev.food.filter((_, i) => i !== index)
    }));
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "Date";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return "Time";
    const [hours, minutes] = timeStr.split(":");
    const h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  // Handle JSON changes
  const handleJsonChange = useCallback((value: string | undefined) => {
    if (!value) return;
    setJsonValue(value);

    try {
      const parsed = JSON.parse(value);
      setJsonError("");

      // Update form data from JSON
      setFormData({
        title: parsed.title || "",
        description: parsed.description || "",
        date: parsed.date || smartDefaults.date,
        time: parsed.time || smartDefaults.time,
        location: parsed.location || "",
        category: parsed.category || "",
        price: typeof parsed.price === "number" ? parsed.price : 0,
        food: Array.isArray(parsed.food) ? parsed.food : [],
        requiresRegistration: typeof parsed.requiresRegistration === "boolean" ? parsed.requiresRegistration : false,
        organization: parsed.organization || "",
      });
    } catch {
      setJsonError("Invalid JSON format");
    }
  }, [smartDefaults.date, smartDefaults.time]);

  // Handle AI generation
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    setAiGenerating(true);
    setJsonError("");

    try {
      const newEvent = await generateEventWithAI(aiPrompt, (partialJson) => {
        setJsonValue(partialJson);
      });

      const generatedJson = JSON.stringify(newEvent, null, 2);
      setJsonValue(generatedJson);
      handleJsonChange(generatedJson);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Failed to generate event");
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, handleJsonChange]);

  const isFormValid = formData.title.trim() && formData.organization.trim() && formData.date && formData.time && formData.location;

  // Promotion success screen
  if (promotionSuccess) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogTitle className="sr-only">Event Promoted</DialogTitle>
          <div className="flex flex-col items-center text-center py-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-white" strokeWidth={3} />
            </div>

            <h2 className="text-xl font-bold text-foreground mb-2">Event Promoted!</h2>
            <p className="text-muted-foreground text-sm mb-6">
              "{formData.title}" is now featured and will appear at the top of search results.
            </p>

            <div className="flex items-center gap-2 bg-warning/20 px-4 py-2 rounded-full mb-6">
              <Coins className="w-5 h-5 text-warning" />
              <span className="font-bold text-warning">
                {userCredits} credits remaining
              </span>
            </div>

            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Promotion upsell screen
  if (showPromotion) {
    const selectedPkg = PROMOTION_PACKAGES.find(p => p.id === selectedPromotion);
    const canAfford = selectedPkg ? userCredits >= selectedPkg.credits : false;

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogTitle className="sr-only">Boost Your Event</DialogTitle>
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>

          <div className="py-2">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                <Megaphone className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Boost Your Event</h2>
                <p className="text-sm text-muted-foreground">
                  Get more visibility for "{formData.title}"
                </p>
              </div>
            </div>

            {/* Credits balance */}
            <div className="flex items-center justify-between bg-warning/20 px-4 py-2 rounded-lg mb-4">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-warning" />
                <span className="font-semibold text-warning">{userCredits} credits</span>
              </div>
              <button
                onClick={onBuyCredits}
                className="text-xs font-medium text-warning hover:text-warning/80"
              >
                + Buy more
              </button>
            </div>

            <div className="space-y-3 mb-6">
              {PROMOTION_PACKAGES.map((pkg) => {
                const isSelected = selectedPromotion === pkg.id;
                const affordable = userCredits >= pkg.credits;

                return (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPromotion(pkg.id)}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-all relative ${isSelected
                      ? "border-primary bg-primary/10"
                      : affordable
                        ? "border-border hover:border-primary/50"
                        : "border-border opacity-60"
                      }`}
                    disabled={!affordable}
                  >
                    {pkg.id === "combo" && (
                      <div className="absolute -top-2 left-4 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded">
                        BEST VALUE
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected
                            ? "border-primary bg-primary"
                            : "border-border"
                            }`}
                        >
                          {isSelected && (
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{pkg.name}</p>
                          <p className="text-xs text-muted-foreground">{pkg.description}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1">
                          <Coins className="w-4 h-4 text-warning" />
                          <span className="font-bold text-foreground">{pkg.credits}</span>
                        </div>
                        {pkg.originalCredits && (
                          <p className="text-xs text-muted-foreground line-through">
                            {pkg.originalCredits} credits
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">{pkg.duration} day{pkg.duration > 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    {!affordable && (
                      <p className="text-xs text-error mt-2">Not enough credits</p>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Maybe Later
              </Button>
              <Button
                onClick={handlePromote}
                disabled={!selectedPromotion || !canAfford}
                className="flex-1 bg-primary hover:bg-primary/90"
              >
                {selectedPkg ? (
                  <span className="flex items-center gap-1.5">
                    <Coins className="w-4 h-4" />
                    Spend {selectedPkg.credits} credits
                  </span>
                ) : (
                  "Select a package"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Success screen (skip for edit mode)
  if (isSubmitted && !isEditMode) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogTitle className="sr-only">Event Created</DialogTitle>
          <div className="flex flex-col items-center text-center py-4">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center">
                <Check className="w-8 h-8 text-white" strokeWidth={3} />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-warning rounded-full flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
            </div>

            <h2 className="text-xl font-bold text-foreground mb-2">
              {isEditMode ? "Event Updated!" : "Event Created!"}
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              "{formData.title}" {isEditMode ? "has been updated." : "is now live and visible to students."}
            </p>

            <div className="w-full rounded-lg p-4 mb-6 text-left bg-muted">
              <p className="font-medium text-foreground mb-1">{formData.title}</p>
              <p className="text-sm text-muted-foreground">{formData.organization}</p>
              <p className="text-sm text-muted-foreground mt-2">
                {formatDate(formData.date)} at {formatTime(formData.time)}
              </p>
            </div>

            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Done
              </Button>
              <Button
                onClick={() => setShowPromotion(true)}
                className="flex-1 bg-primary hover:bg-primary/90"
              >
                <Megaphone className="w-4 h-4 mr-1.5" />
                Promote
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="p-0 w-[calc(100vw-48px)] max-w-[900px] h-[calc(100vh-48px)] max-h-[750px] overflow-hidden flex flex-col" showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle className="sr-only">{isEditMode ? "Edit Event" : "Create Event"}</DialogTitle>
        {/* Close Button - Top Right of Modal */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 p-2 hover:bg-gray-200 rounded-lg transition-colors z-10"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Form Panel */}
          <div className="flex-1 p-6 overflow-y-auto min-h-0">
            {/* Header with Tabs */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-foreground">{isEditMode ? "Edit Event" : "Create Event"}</h2>
                <p className="text-sm text-muted-foreground">{isEditMode ? "Update the event details below" : "Fill in the details below"}</p>
              </div>
              <div className="flex gap-1 bg-muted rounded p-0.5">
                <button
                  onClick={() => setViewMode("visual")}
                  className={`${viewMode === "visual"
                    ? "bg-card text-foreground shadow-sm"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                    } font-medium text-[11px] px-3 py-1 rounded transition-all`}
                >
                  Visual
                </button>
                <button
                  onClick={() => setViewMode("json")}
                  className={`${viewMode === "json"
                    ? "bg-card text-foreground shadow-sm"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                    } font-medium text-[11px] px-3 py-1 rounded transition-all`}
                >
                  JSON
                </button>
              </div>
            </div>

            {viewMode === "visual" ? (
              <div className="space-y-5">
                {/* AI Generation Input - Always Visible */}
                <div className="space-y-2 pb-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-medium text-foreground">AI Event Generation</span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={aiGenerating ? "Generating..." : "Describe your event (e.g. 'tech talk about AI next Friday')..."}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && aiPrompt.trim() && !aiGenerating) {
                          handleAiGenerate();
                        }
                      }}
                      disabled={aiGenerating}
                      className="w-full bg-muted text-foreground text-xs px-3 py-2.5 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 border border-border placeholder:text-muted-foreground disabled:opacity-60"
                    />
                    {aiPrompt && !aiGenerating && (
                      <button
                        onClick={() => setAiPrompt("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {aiGenerating && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-3 h-3 border-2 border-border border-t-primary rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  {jsonError && (
                    <div className="bg-error/10 border border-error/20 text-error px-3 py-2 rounded-xl text-[11px]">
                      {jsonError}
                    </div>
                  )}
                </div>

                {/* Required Section */}
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      Event Title <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      onBlur={() => handleBlur("title")}
                      placeholder="e.g., Tech Talk: AI in 2024"
                      className={`w-full px-3 py-2.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all text-foreground placeholder:text-muted-foreground ${errors.title ? "border-error bg-error/10" : "border-border bg-muted"
                        }`}
                    />
                    {errors.title && (
                      <p className="text-xs text-error mt-1">{errors.title}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      Organization <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.organization}
                      onChange={(e) => setFormData(prev => ({ ...prev, organization: e.target.value }))}
                      onBlur={() => handleBlur("organization")}
                      placeholder="e.g., Computer Science Club"
                      className={`w-full px-3 py-2.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all text-foreground placeholder:text-muted-foreground ${errors.organization ? "border-error bg-error/10" : "border-border bg-muted"
                        }`}
                    />
                    {errors.organization && (
                      <p className="text-xs text-error mt-1">{errors.organization}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        Date <span className="text-error">*</span>
                      </label>
                      <input
                        type="date"
                        value={formData.date}
                        onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                        onBlur={() => handleBlur("date")}
                        className={`w-full px-3 py-2.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 text-foreground ${errors.date ? "border-error bg-error/10" : "border-border bg-muted"
                          }`}
                      />
                      {errors.date && (
                        <p className="text-xs text-error mt-1">{errors.date}</p>
                      )}
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground mb-1.5 block">
                        Time <span className="text-error">*</span>
                      </label>
                      <input
                        type="time"
                        value={formData.time}
                        onChange={(e) => setFormData(prev => ({ ...prev, time: e.target.value }))}
                        onBlur={() => handleBlur("time")}
                        className={`w-full px-3 py-2.5 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 text-foreground ${errors.time ? "border-error bg-error/10" : "border-border bg-muted"
                          }`}
                      />
                      {errors.time && (
                        <p className="text-xs text-error mt-1">{errors.time}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" />
                      Location <span className="text-error">*</span>
                    </label>
                    <Select
                      value={formData.location}
                      onValueChange={(value) => {
                        setFormData(prev => ({ ...prev, location: value }));
                        setTouched(prev => ({ ...prev, location: true }));
                      }}
                    >
                      <SelectTrigger className={`w-full ${errors.location ? "border-error bg-error/10" : ""}`}>
                        <SelectValue placeholder="Select a location" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLocations.map((loc) => (
                          <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.location && (
                      <p className="text-xs text-error mt-1">{errors.location}</p>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-border my-2" />

                {/* Optional Section */}
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Optional Details</p>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Tell people what your event is about..."
                      rows={2}
                      className="w-full px-3 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 resize-none bg-muted text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1.5 block">
                        Category
                      </label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCategories.map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4" />
                        Price
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.price}
                          onChange={(e) => setFormData(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                          placeholder="0"
                          className="w-full pl-7 pr-3 py-2.5 border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 bg-muted text-foreground"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                      <Utensils className="w-4 h-4" />
                      Food Provided
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={foodInput}
                        onChange={(e) => setFoodInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFood())}
                        placeholder="e.g., Pizza, Snacks"
                        className="flex-1 px-3 py-2.5 border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 bg-muted text-foreground placeholder:text-muted-foreground"
                      />
                      <button
                        type="button"
                        onClick={addFood}
                        className="w-[38px] h-[38px] flex items-center justify-center border border-border rounded-xl hover:bg-gray-200 transition-colors flex-shrink-0 bg-muted"
                      >
                        <Plus className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                    {formData.food.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {formData.food.map((item) => (
                          <span
                            key={item}
                            className="inline-flex items-center gap-1 bg-warning/20 text-warning text-xs px-2 py-1 rounded-full"
                          >
                            {item}
                            <button
                              type="button"
                              onClick={() => removeFood(formData.food.indexOf(item))}
                              className="hover:bg-warning/30 rounded-full p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">Requires registration</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, requiresRegistration: !prev.requiresRegistration }))}
                      className={`w-10 h-6 rounded-full transition-colors relative ${formData.requiresRegistration ? "bg-primary" : "bg-gray-200"
                        }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 bg-card rounded-full shadow transition-transform ${formData.requiresRegistration ? "translate-x-5" : "translate-x-1"
                          }`}
                      />
                    </button>
                  </div>

                  {/* Cover Image */}
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">
                      Cover Image
                    </label>
                    <div className="border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-primary transition-colors cursor-pointer">
                      <ImagePlus className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                      <p className="text-xs text-muted-foreground">Click to upload</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* JSON View */
              <div className="space-y-4">
                {/* AI Prompt Input - Same as Visual view */}
                <div className="space-y-2 pb-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-medium text-foreground">AI Event Generation</span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={aiGenerating ? "Generating..." : "Describe your event (e.g. 'tech talk about AI next Friday')..."}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && aiPrompt.trim() && !aiGenerating) {
                          handleAiGenerate();
                        }
                      }}
                      disabled={aiGenerating}
                      className="w-full bg-muted text-foreground text-xs px-3 py-2.5 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 border border-border placeholder:text-muted-foreground disabled:opacity-60"
                    />
                    {aiPrompt && !aiGenerating && (
                      <button
                        onClick={() => setAiPrompt("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {aiGenerating && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-3 h-3 border-2 border-border border-t-primary rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>

                {jsonError && (
                    <div className="bg-error/10 border border-error/20 text-error px-3 py-2 rounded text-[11px]">
                    {jsonError}
                  </div>
                )}

                {/* Monaco Editor */}
                <div className="border border-border rounded overflow-hidden">
                  <Suspense fallback={
                    <div className="flex items-center justify-center h-[350px] bg-muted">
                      <div className="text-muted-foreground text-sm">Loading editor...</div>
                    </div>
                  }>
                    <Editor
                      height="350px"
                      defaultLanguage="json"
                      value={jsonValue}
                      onChange={handleJsonChange}
                      theme={isDarkMode ? "vs-dark" : "vs-light"}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: "off",
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        wrappingIndent: "indent",
                        automaticLayout: true,
                        tabSize: 2,
                        formatOnPaste: true,
                        formatOnType: true,
                      }}
                    />
                  </Suspense>
                </div>
              </div>
            )}
          </div>

          {/* Live Preview Panel */}
          <div className="w-80 bg-muted border-l border-border p-6 overflow-y-auto min-h-0">
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Live Preview</span>
            </div>

            {/* Preview Card - Matches EventCard styling */}
            <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
              {/* Image area with category badge */}
              <div className="relative h-32 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                <ImagePlus className="w-6 h-6 text-muted-foreground" />
                {formData.category && (
                  <BadgeMask variant="top-left">
                    <span 
                      className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${getCategoryClasses(formData.category).bg} ${getCategoryClasses(formData.category).text}`}
                    >
                      {formData.category}
                    </span>
                  </BadgeMask>
                )}
                {/* Club badge - bottom left */}
                <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full border-2 border-card shadow-lg flex items-center justify-center flex-shrink-0 bg-card bg-gradient-to-br from-primary/20 to-primary/10"
                  >
                    <Users className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
                  </div>
                  <span 
                    className="font-bold text-[10px] text-white truncate max-w-[100px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.4)]"
                  >
                    {formData.organization || "Organization"}
                  </span>
                </div>
              </div>
              <div className="p-4">
                {/* Title first */}
                <h3 className="font-medium text-[12px] leading-tight mb-2 line-clamp-2 text-foreground">
                  {formData.title || "Event Title"}
                </h3>
                
                {/* Badges - light background styling */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {formData.price === 0 ? (
                    <span 
                      className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-success/20 text-success"
                    >
                      Free
                    </span>
                  ) : (
                    <span 
                      className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-primary/20 text-primary"
                    >
                      ${formData.price}
                    </span>
                  )}
                  {formData.food.length > 0 && (
                    <span 
                      className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-warning/20 text-warning"
                    >
                      Free Food
                    </span>
                  )}
                  {formData.requiresRegistration && (
                    <span 
                      className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-primary/20 text-primary"
                    >
                      Registration Required
                    </span>
                  )}
                </div>

                {/* Event Info */}
                <div className="space-y-1 mb-3">
                  <div className="flex gap-1.5 items-center">
                    <Calendar className="w-3 h-3 flex-shrink-0 text-muted-foreground" strokeWidth={2} />
                    <span className="text-[11px] truncate text-muted-foreground">
                      {formatDate(formData.date)} at {formatTime(formData.time)}
                    </span>
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <MapPin className="w-3 h-3 flex-shrink-0 text-muted-foreground" strokeWidth={2} />
                    <span className="text-[11px] truncate text-muted-foreground">
                      {formData.location || "Location"}
                    </span>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px mb-3 bg-gradient-to-r from-transparent via-border to-transparent" />

                {/* View More button placeholder */}
                <div 
                  className="w-full text-white font-medium text-[11px] h-8 rounded-xl flex items-center justify-center gap-1.5 shadow-sm bg-primary"
                >
                  View More
                </div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground text-center mt-3">
              This is how your event will appear to others
            </p>

            {/* Submit Button */}
            <Button
              onClick={handleSubmit}
              disabled={!isFormValid}
              className="w-full mt-4"
              size="lg"
            >
              {isEditMode ? "Update Event" : "Create Event"}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SubmitEventModal;
