import React, {
  useState,
  useEffect,
  useCallback,
  Suspense,
  lazy,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar as CalendarIcon,
  MapPin,
  DollarSign,
  Users,
  Utensils,
  Plus,
  ImagePlus,
  Check,
  Sparkles,
  X,
  Eye,
  Megaphone,
  ChevronRight,
  Coins,
  ChevronDownIcon,
} from "lucide-react";
import confetti from "canvas-confetti";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BadgeMask } from "@/components/ui/badge-mask";
import { SuccessAlert } from "@/components/ui/success-alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
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
  onPromote?: (
    eventId: number,
    packageId: string,
    credits: number,
    duration: number
  ) => boolean;
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
    Events: { bg: "bg-category-events-bg", text: "text-category-events-text" },
    Clubs: { bg: "bg-category-clubs-bg", text: "text-category-clubs-text" },
    Academic: {
      bg: "bg-category-academic-bg",
      text: "text-category-academic-text",
    },
    Religious: {
      bg: "bg-category-religious-bg",
      text: "text-category-religious-text",
    },
    Cultural: {
      bg: "bg-category-cultural-bg",
      text: "text-category-cultural-text",
    },
    "Social & Games": {
      bg: "bg-category-social-bg",
      text: "text-category-social-text",
    },
    "Sports & Fitness": {
      bg: "bg-category-sports-bg",
      text: "text-category-sports-text",
    },
    Career: { bg: "bg-category-career-bg", text: "text-category-career-text" },
    Technology: {
      bg: "bg-category-technology-bg",
      text: "text-category-technology-text",
    },
    "Arts & Crafts": {
      bg: "bg-category-arts-bg",
      text: "text-category-arts-text",
    },
    "Health & Wellness": {
      bg: "bg-category-health-bg",
      text: "text-category-health-text",
    },
    "Music & Performance": {
      bg: "bg-category-music-bg",
      text: "text-category-music-text",
    },
    Entrepreneurship: {
      bg: "bg-category-entrepreneurship-bg",
      text: "text-category-entrepreneurship-text",
    },
  };
  return (
    mapping[category] || {
      bg: "bg-category-default-bg",
      text: "text-category-default-text",
    }
  );
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
  const { t } = useTranslation();
  const isEditMode = !!editEventId && !!initialData;
  // Detect dark mode from document class
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>("visual");

  // Promotion state
  const [selectedPromotion, setSelectedPromotion] = useState<string | null>(
    null
  );
  const [promotionSuccess, setPromotionSuccess] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<number | null>(null);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

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
  // Date picker state - convert string date to Date object
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    if (smartDefaults.date) {
      const date = new Date(smartDefaults.date);
      return isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
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
        // Sync selectedDate with initialData.date
        if (initialData.date) {
          const date = new Date(initialData.date);
          setSelectedDate(isNaN(date.getTime()) ? undefined : date);
        } else {
          setSelectedDate(undefined);
        }
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
        // Sync selectedDate with defaults.date
        if (defaults.date) {
          const date = new Date(defaults.date);
          setSelectedDate(isNaN(date.getTime()) ? undefined : date);
        } else {
          setSelectedDate(undefined);
        }
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
        colors: ["#3B82F6", "#60A5FA", "#10B981", "#F59E0B"],
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
    setTouched((prev) => ({ ...prev, [field]: true }));
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
    if (
      !formData.title.trim() ||
      !formData.organization.trim() ||
      !formData.date ||
      !formData.time ||
      !formData.location
    ) {
      return;
    }

    // If in edit mode, update the event
    if (isEditMode && editEventId && onUpdate) {
      onUpdate(editEventId, formData);
      setSuccessMessage(`Event "${formData.title}" has been updated.`);
      setShowSuccessAlert(true);
      return;
    }

    // Otherwise, create new event
    const eventId = onSubmit(formData);
    setCreatedEventId(eventId);
    setIsSubmitted(true);
    // Note: The success screen in the modal will show, but we'll also show an alert when they close it
  };

  // Handle promotion purchase
  const handlePromote = () => {
    if (!selectedPromotion || !createdEventId || !onPromote) return;

    const pkg = PROMOTION_PACKAGES.find((p) => p.id === selectedPromotion);
    if (!pkg) return;

    const success = onPromote(
      createdEventId,
      pkg.id,
      pkg.credits,
      pkg.duration
    );
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
    // If we just created an event, show success alert
    if (isSubmitted && !isEditMode && createdEventId) {
      setSuccessMessage(
        `Event "${formData.title}" has been created successfully!`
      );
      setShowSuccessAlert(true);
    } else {
      onClose();
    }
  };

  const addFood = () => {
    if (foodInput.trim()) {
      setFormData((prev) => ({
        ...prev,
        food: [...prev.food, foodInput.trim()],
      }));
      setFoodInput("");
    }
  };

  const removeFood = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      food: prev.food.filter((_, i) => i !== index),
    }));
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return t("events.date");
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return t("events.time");
    const [hours, minutes] = timeStr.split(":");
    const h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  // Handle JSON changes
  const handleJsonChange = useCallback(
    (value: string | undefined) => {
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
          requiresRegistration:
            typeof parsed.requiresRegistration === "boolean"
              ? parsed.requiresRegistration
              : false,
          organization: parsed.organization || "",
        });
      } catch {
        setJsonError("Invalid JSON format");
      }
    },
    [smartDefaults.date, smartDefaults.time]
  );

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
      setJsonError(
        error instanceof Error ? error.message : "Failed to generate event"
      );
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, handleJsonChange]);

  const isFormValid =
    formData.title.trim() &&
    formData.organization.trim() &&
    formData.date &&
    formData.time &&
    formData.location;

  // Promotion success screen
  if (promotionSuccess) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogTitle className="sr-only">Event Promoted</DialogTitle>
          <div className="flex flex-col items-center text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Check className="w-8 h-8 text-white" strokeWidth={3} />
            </div>

            <h2 className="text-xl font-bold text-foreground">
              Event Promoted!
            </h2>
            <p className="text-muted-foreground text-sm">
              "{formData.title}" is now featured and will appear at the top of
              search results.
            </p>

            <div className="flex items-center gap-2 bg-warning/20 px-4 py-2 rounded-full">
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
    const selectedPkg = PROMOTION_PACKAGES.find(
      (p) => p.id === selectedPromotion
    );
    const canAfford = selectedPkg ? userCredits >= selectedPkg.credits : false;

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-md" showCloseButton={true}>
          <DialogHeader>
            <DialogTitle>Boost Your Event</DialogTitle>
            <DialogDescription>
              Get more visibility for "{formData.title}"
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {/* Credits balance */}
            <div className="flex items-center justify-between bg-warning/20 px-4 py-2 rounded-lg">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-warning" />
                <span className="font-semibold text-warning">
                  {userCredits} credits
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onBuyCredits}
                className="text-xs font-medium text-warning hover:text-warning/80 h-auto p-0"
              >
                + Buy more
              </Button>
            </div>

            <div className="space-y-3">
              {PROMOTION_PACKAGES.map((pkg) => {
                const isSelected = selectedPromotion === pkg.id;
                const affordable = userCredits >= pkg.credits;

                return (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPromotion(pkg.id)}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-all relative ${
                      isSelected
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
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected
                              ? "border-primary bg-primary"
                              : "border-border"
                          }`}
                        >
                          {isSelected && (
                            <Check
                              className="w-3 h-3 text-white"
                              strokeWidth={3}
                            />
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">
                            {pkg.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {pkg.description}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1">
                          <Coins className="w-4 h-4 text-warning" />
                          <span className="font-bold text-foreground">
                            {pkg.credits}
                          </span>
                        </div>
                        {pkg.originalCredits && (
                          <p className="text-xs text-muted-foreground line-through">
                            {pkg.originalCredits} credits
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {pkg.duration} day{pkg.duration > 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    {!affordable && (
                      <p className="text-xs text-error">Not enough credits</p>
                    )}
                  </button>
                );
              })}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" className="flex-1">
                  Maybe Later
                </Button>
              </DialogClose>
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
            </DialogFooter>
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
          <div className="flex flex-col items-center text-center py-4 space-y-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center">
                <Check className="w-8 h-8 text-white" strokeWidth={3} />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-warning rounded-full flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
            </div>

            <h2 className="text-xl font-bold text-foreground">
              {isEditMode ? "Event Updated!" : "Event Created!"}
            </h2>
            <p className="text-muted-foreground text-sm">
              "{formData.title}"{" "}
              {isEditMode
                ? "has been updated."
                : "is now live and visible to students."}
            </p>

            <div className="w-full rounded-lg p-4 text-left bg-muted space-y-1">
              <p className="font-medium text-foreground">{formData.title}</p>
              <p className="text-sm text-muted-foreground">
                {formData.organization}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatDate(formData.date)} at {formatTime(formData.time)}
              </p>
            </div>

            <div className="flex gap-2 w-full">
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  setTimeout(() => {
                    setSuccessMessage(
                      `Event "${formData.title}" has been created successfully!`
                    );
                    setShowSuccessAlert(true);
                  }, 100);
                }}
                className="flex-1"
              >
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
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent
          className="p-0 w-[calc(100vw-48px)] max-w-[900px] h-[calc(100vh-48px)] max-h-[750px] overflow-hidden flex flex-col"
          showCloseButton={true}
          aria-describedby={undefined}
        >
        
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Form Panel */}
            <div className="flex-1 p-6 overflow-y-auto min-h-0">
              {/* Header with Tabs */}
              <div className="mb-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-bold text-foreground">
                      {isEditMode ? "Edit Event" : "Create Event"}
                    </h2>
                  </div>
                  <div className="shrink-0">
                    <Tabs
                      value={viewMode}
                      onValueChange={(value) => setViewMode(value as ViewMode)}
                      className="w-fit"
                    >
                      <TabsList variant="default" className="h-8">
                        <TabsTrigger
                          value="visual"
                          className="text-[11px] font-medium px-3 py-1"
                        >
                          Visual
                        </TabsTrigger>
                        <TabsTrigger
                          value="json"
                          className="text-[11px] font-medium px-3 py-1"
                        >
                          JSON
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>
              </div>

              {viewMode === "visual" ? (
                <FieldGroup>
                  {/* AI Generation Input */}
                  <Field>
                    <FieldLabel className="text-xs font-medium text-foreground flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      AI Event Generation
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        type="text"
                        placeholder={
                          aiGenerating
                            ? t("common.generating")
                            : t("forms.aiPromptPlaceholder")
                        }
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            aiPrompt.trim() &&
                            !aiGenerating
                          ) {
                            handleAiGenerate();
                          }
                        }}
                        disabled={aiGenerating}
                        className="w-full bg-muted text-xs pr-8 rounded-xl"
                      />
                      {aiPrompt && !aiGenerating && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setAiPrompt("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {aiGenerating && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-3 h-3 border-2 border-border border-t-primary rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    {jsonError && (
                      <FieldError className="text-xs">{jsonError}</FieldError>
                    )}
                  </Field>
                  <FieldSeparator />
                  <form>
                    <FieldGroup>
                      <FieldSet>
                        <FieldLegend>Event Information</FieldLegend>
                        <FieldDescription>
                          All fields marked with * are required
                        </FieldDescription>
                        <FieldGroup>
                          <Field>
                            <FieldLabel
                              htmlFor="event-title"
                              className="text-sm font-medium text-foreground"
                            >
                              {t("events.eventTitle")}{" "}
                              <span className="text-error">*</span>
                            </FieldLabel>
                            <Input
                              id="event-title"
                              type="text"
                              value={formData.title}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  title: e.target.value,
                                }))
                              }
                              onBlur={() => handleBlur("title")}
                              placeholder={t("forms.eventTitlePlaceholder")}
                              className={`w-full text-xs ${
                                errors.title ? "border-error bg-error/10" : ""
                              }`}
                            />
                            {errors.title && (
                              <FieldError className="text-xs">
                                {errors.title}
                              </FieldError>
                            )}
                          </Field>

                          <Field>
                            <FieldLabel
                              htmlFor="organization"
                              className="text-sm font-medium text-foreground"
                            >
                              {t("events.organization")}{" "}
                              <span className="text-error">*</span>
                            </FieldLabel>
                            <Input
                              id="organization"
                              type="text"
                              value={formData.organization}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  organization: e.target.value,
                                }))
                              }
                              onBlur={() => handleBlur("organization")}
                              placeholder={t("forms.organizationPlaceholder")}
                              className={`w-full text-xs ${
                                errors.organization
                                  ? "border-error bg-error/10"
                                  : ""
                              }`}
                            />
                            {errors.organization && (
                              <FieldError className="text-xs">
                                {errors.organization}
                              </FieldError>
                            )}
                          </Field>

                          <FieldGroup className="grid grid-cols-2">
                            <Field>
                              <FieldLabel
                                htmlFor="event-date"
                                className="text-sm font-medium text-foreground flex items-center gap-1.5"
                              >
                                <CalendarIcon className="w-4 h-4" />
                                Date <span className="text-error">*</span>
                              </FieldLabel>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    id="event-date"
                                    data-empty={!selectedDate}
                                    className={`w-full justify-between text-left font-normal text-xs h-9 data-[empty=true]:text-muted-foreground ${
                                      errors.date
                                        ? "border-error bg-error/10"
                                        : ""
                                    }`}
                                    onBlur={() => handleBlur("date")}
                                  >
                                    {selectedDate ? (
                                      format(selectedDate, "PPP")
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                    <ChevronDownIcon />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-auto p-0"
                                  align="start"
                                >
                                  <Calendar
                                    mode="single"
                                    selected={selectedDate}
                                    onSelect={(date) => {
                                      setSelectedDate(date);
                                      if (date) {
                                        const dateStr = date
                                          .toISOString()
                                          .split("T")[0];
                                        setFormData((prev) => ({
                                          ...prev,
                                          date: dateStr,
                                        }));
                                      }
                                    }}
                                    defaultMonth={selectedDate}
                                  />
                                </PopoverContent>
                              </Popover>
                              {errors.date && (
                                <FieldError className="text-xs">
                                  {errors.date}
                                </FieldError>
                              )}
                            </Field>
                            <Field>
                              <FieldLabel
                                htmlFor="event-time"
                                className="text-sm font-medium text-foreground"
                              >
                                Time <span className="text-error">*</span>
                              </FieldLabel>
                              <Input
                                type="time"
                                id="event-time"
                                step="1"
                                value={formData.time}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    time: e.target.value,
                                  }))
                                }
                                onBlur={() => handleBlur("time")}
                                className={`w-full text-xs h-9 bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none ${
                                  errors.time ? "border-error bg-error/10" : ""
                                }`}
                              />
                              {errors.time && (
                                <FieldError className="text-xs">
                                  {errors.time}
                                </FieldError>
                              )}
                            </Field>
                          </FieldGroup>

                          <Field>
                            <FieldLabel
                              htmlFor="location-select"
                              className="text-sm font-medium text-foreground flex items-center gap-1.5"
                            >
                              <MapPin className="w-4 h-4" />
                              Location <span className="text-error">*</span>
                            </FieldLabel>
                            <Select
                              value={formData.location}
                              onValueChange={(value) => {
                                setFormData((prev) => ({
                                  ...prev,
                                  location: value,
                                }));
                                setTouched((prev) => ({
                                  ...prev,
                                  location: true,
                                }));
                              }}
                            >
                              <SelectTrigger
                                id="location-select"
                                className={`w-full ${
                                  errors.location
                                    ? "border-error bg-error/10"
                                    : ""
                                }`}
                              >
                                <SelectValue
                                  placeholder={t("forms.selectLocation")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {availableLocations.map((loc) => (
                                  <SelectItem key={loc} value={loc}>
                                    {loc}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {errors.location && (
                              <FieldError className="text-xs">
                                {errors.location}
                              </FieldError>
                            )}
                          </Field>
                        </FieldGroup>
                      </FieldSet>

                      <FieldSeparator />

                      <FieldSet>
                        <FieldLegend>Optional Details</FieldLegend>
                        <FieldGroup>
                          <Field>
                            <FieldLabel
                              htmlFor="description"
                              className="text-sm font-medium text-foreground"
                            >
                              Description
                            </FieldLabel>
                            <Textarea
                              id="description"
                              value={formData.description}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  description: e.target.value,
                                }))
                              }
                              placeholder="Tell people what your event is about..."
                              rows={2}
                              className="w-full text-sm"
                            />
                          </Field>

                          <FieldGroup className="grid grid-cols-2">
                            <Field>
                              <FieldLabel
                                htmlFor="category-select"
                                className="text-sm font-medium text-foreground"
                              >
                                Category
                              </FieldLabel>
                              <Select
                                value={formData.category}
                                onValueChange={(value) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    category: value,
                                  }))
                                }
                              >
                                <SelectTrigger
                                  id="category-select"
                                  className="w-full"
                                >
                                  <SelectValue
                                    placeholder={t("forms.selectCategory")}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableCategories.map((cat) => (
                                    <SelectItem key={cat} value={cat}>
                                      {cat}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>

                            <Field>
                              <FieldLabel
                                htmlFor="price"
                                className="text-sm font-medium text-foreground flex items-center gap-1.5"
                              >
                                <DollarSign className="w-4 h-4" />
                                Price
                              </FieldLabel>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm z-10">
                                  $
                                </span>
                                <Input
                                  id="price"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={formData.price}
                                  onChange={(e) =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      price: parseFloat(e.target.value) || 0,
                                    }))
                                  }
                                  placeholder={t("forms.pricePlaceholder")}
                                  className="w-full pl-7 text-xs"
                                />
                              </div>
                            </Field>
                          </FieldGroup>

                          <Field>
                            <FieldLabel
                              htmlFor="food-input"
                              className="text-sm font-medium text-foreground flex items-center gap-1.5"
                            >
                              <Utensils className="w-4 h-4" />
                              Food Provided
                            </FieldLabel>
                            <div className="flex gap-2">
                              <Input
                                id="food-input"
                                type="text"
                                value={foodInput}
                                onChange={(e) => setFoodInput(e.target.value)}
                                onKeyDown={(e) =>
                                  e.key === "Enter" &&
                                  (e.preventDefault(), addFood())
                                }
                                placeholder={t("forms.foodPlaceholder")}
                                className="flex-1 text-xs"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={addFood}
                                className="flex-shrink-0"
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </div>
                            {formData.food.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {formData.food.map((item) => (
                                  <span
                                    key={item}
                                    className="inline-flex items-center gap-1 bg-warning/20 text-warning text-xs px-2 py-1 rounded-full"
                                  >
                                    {item}
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() =>
                                        removeFood(formData.food.indexOf(item))
                                      }
                                      className="hover:bg-warning/30 rounded-full p-0.5 h-auto w-auto"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </Field>

                          <Field>
                            <FieldLabel htmlFor="requires-registration">
                              Requires registration
                            </FieldLabel>
                            <div className="w-fit">
                              <Switch
                                id="requires-registration"
                                checked={formData.requiresRegistration}
                                onCheckedChange={(checked) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    requiresRegistration: checked,
                                  }))
                                }
                              />
                            </div>
                          </Field>

                          {/* Cover Image */}
                          <Field>
                            <FieldLabel className="text-sm font-medium text-foreground">
                              Cover Image
                            </FieldLabel>
                            <div className="border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-primary transition-colors cursor-pointer">
                              <ImagePlus className="w-6 h-6 text-muted-foreground mx-auto" />
                              <p className="text-xs text-muted-foreground mt-1">
                                Click to upload
                              </p>
                            </div>
                          </Field>
                        </FieldGroup>
                      </FieldSet>

                      <Field orientation="horizontal">
                        <DialogClose asChild>
                          <Button variant="outline" type="button">
                            {t("common.cancel")}
                          </Button>
                        </DialogClose>
                        <Button
                          type="button"
                          onClick={handleSubmit}
                          disabled={!isFormValid}
                        >
                          {isEditMode
                            ? t("events.updateEvent")
                            : t("events.createEvent")}
                        </Button>
                      </Field>
                    </FieldGroup>
                  </form>
                </FieldGroup>
              ) : (
                /* JSON View */
                <FieldGroup>
                  {/* AI Generation Input */}
                  <Field>
                    <FieldLabel className="text-xs font-medium text-foreground flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      AI Event Generation
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        type="text"
                        placeholder={
                          aiGenerating
                            ? t("common.generating")
                            : t("forms.aiPromptPlaceholder")
                        }
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            aiPrompt.trim() &&
                            !aiGenerating
                          ) {
                            handleAiGenerate();
                          }
                        }}
                        disabled={aiGenerating}
                        className="w-full bg-muted text-xs pr-8 rounded-xl"
                      />
                      {aiPrompt && !aiGenerating && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setAiPrompt("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {aiGenerating && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-3 h-3 border-2 border-border border-t-primary rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    {jsonError && (
                      <FieldError className="text-xs">{jsonError}</FieldError>
                    )}
                  </Field>

                  <FieldSeparator />

                  {/* Monaco Editor */}
                  <Field>
                    <FieldLabel className="text-xs font-medium text-foreground">
                      JSON Editor
                    </FieldLabel>
                    <div className="border border-border rounded-xl overflow-hidden">
                    <Suspense
                      fallback={
                        <div className="flex items-center justify-center h-[350px] bg-muted">
                          <div className="text-muted-foreground text-sm">
                            Loading editor...
                          </div>
                        </div>
                      }
                    >
                      <Editor
                        key={isDarkMode ? "dark" : "light"}
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
                  </Field>
                </FieldGroup>
              )}
            </div>

            {/* Live Preview Panel */}
            <div className="w-80 bg-muted border-l border-border p-6 overflow-y-auto min-h-0 space-y-4">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  Live Preview
                </span>
              </div>

              {/* Preview Card - Matches EventCard styling */}
              <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                {/* Image area with category badge */}
                <div className="relative h-32 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                  <ImagePlus className="w-6 h-6 text-muted-foreground" />
                  {formData.category && (
                    <BadgeMask variant="top-left">
                      <span
                        className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${
                          getCategoryClasses(formData.category).bg
                        } ${getCategoryClasses(formData.category).text}`}
                      >
                        {formData.category}
                      </span>
                    </BadgeMask>
                  )}
                  {/* Club badge - bottom left */}
                  <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full border-2 border-card shadow-lg flex items-center justify-center flex-shrink-0 bg-card bg-gradient-to-br from-primary/20 to-primary/10">
                      <Users
                        className="w-3.5 h-3.5 text-primary"
                        strokeWidth={2}
                      />
                    </div>
                    <span className="font-bold text-[10px] text-white truncate max-w-[100px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.4)]">
                      {formData.organization || t("events.organization")}
                    </span>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {/* Title first */}
                  <h3 className="font-medium text-[12px] leading-tight line-clamp-2 text-foreground">
                    {formData.title || "Event Title"}
                  </h3>

                  {/* Badges - light background styling */}
                  <div className="flex flex-wrap gap-1.5">
                    {formData.price === 0 ? (
                      <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-success/20 text-success">
                        Free
                      </span>
                    ) : (
                      <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-primary/20 text-primary">
                        ${formData.price}
                      </span>
                    )}
                    {formData.food.length > 0 && (
                      <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-warning/20 text-warning">
                        Free Food
                      </span>
                    )}
                    {formData.requiresRegistration && (
                      <span className="font-medium text-[10px] px-2 py-0.5 rounded-xl bg-primary/20 text-primary">
                        Registration Required
                      </span>
                    )}
                  </div>

                  {/* Event Info */}
                  <div className="space-y-1">
                    <div className="flex gap-1.5 items-center">
                      <CalendarIcon
                        className="w-3 h-3 shrink-0 text-muted-foreground"
                        strokeWidth={2}
                      />
                      <span className="text-[11px] truncate text-muted-foreground">
                        {formatDate(formData.date)} at{" "}
                        {formatTime(formData.time)}
                      </span>
                    </div>
                    <div className="flex gap-1.5 items-center">
                      <MapPin
                        className="w-3 h-3 flex-shrink-0 text-muted-foreground"
                        strokeWidth={2}
                      />
                      <span className="text-[11px] truncate text-muted-foreground">
                        {formData.location || t("events.location")}
                      </span>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

                  {/* View More button placeholder */}
                  <div className="w-full text-white font-medium text-[11px] h-8 rounded-xl flex items-center justify-center gap-1.5 shadow-sm bg-primary">
                    {t("events.viewMore")}
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground text-center">
                {t("events.previewDescription")}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <SuccessAlert
        isOpen={showSuccessAlert}
        onClose={() => {
          setShowSuccessAlert(false);
          onClose();
        }}
        title={isEditMode ? t("events.eventUpdated") : t("events.eventCreated")}
        message={successMessage}
      />
    </>
  );
}

export default SubmitEventModal;
