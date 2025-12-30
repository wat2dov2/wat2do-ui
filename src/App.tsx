import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Users,
  Calendar,
  CalendarDays,
  LogIn,
  LogOut,
  Grid3x3,
  Map as MapIcon,
  SlidersHorizontal,
  Info,
  Mail,
  Compass,
  Plus,
  Megaphone,
  Tag,
  MapPin,
  Utensils,
  ArrowUpDown,
  Sparkles,
  Clock,
  X,
  Heart,
  User,
  FileText,
  Star,
  Bell,
  Palette,
  Shield,
  HelpCircle,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { AboutPage } from "@/components/AboutPage";
import { OnboardingModal } from "@/components/OnboardingModal";
import { FilterTag } from "@/components/Dropdown";

// Lazy load Monaco Editor (3.6MB) - only needed for JSON filter view
const Editor = lazy(() => import("@monaco-editor/react"));
import { DatePicker } from "@/components/DatePicker";
import { FilterSection } from "@/components/FilterSection";
import { EventCard } from "@/components/EventCard";
import { GettingStartedChecklist } from "@/components/GettingStartedChecklist";
import { SubmitEventModal } from "@/components/SubmitEventModal";
import { SchoolCombobox } from "@/components/SchoolCombobox";
import { MyEventsView } from "@/components/MyEventsView";
import { PieMenu } from "@/components/ui/pie-menu";
import { usePieMenu } from "@/hooks/usePieMenu";
import { useEasterEggs } from "@/hooks/useEasterEggs";
import { EasterEggs } from "@/components/EasterEggs";
import type { ViewMode, FilterViewMode, PageMode, FilterState, PromotedEvent, Event } from "@/types";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { generateFiltersWithAI, isApiKeyConfigured } from "@/lib/openai";
import {
  mockEvents,
  availableCategories,
  availableLocations,
  availableDays,
  availableFoods,
} from "@/data/events";

// Helper to get day of week from date string
const getDayOfWeek = (dateStr: string): string => {
  const date = new Date(dateStr);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getDay()];
};

export default function App() {
  // Page and view states
  const [pageMode, setPageMode] = useState<PageMode>("events");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filterViewMode, setFilterViewMode] = useState<FilterViewMode>("visual");

  // Events state (combines mock events with user-created events)
  const [events, setEvents] = useState<Event[]>(() => {
    const savedEvents = localStorage.getItem('userCreatedEvents');
    const userEvents: Event[] = savedEvents ? JSON.parse(savedEvents) : [];
    return [...mockEvents, ...userEvents];
  });

  // Track user-created event IDs separately for persistence
  const [userCreatedEventIds, setUserCreatedEventIds] = useState<number[]>(() => {
    const saved = localStorage.getItem('userCreatedEventIds');
    return saved ? JSON.parse(saved) : [];
  });

  // Persist user-created events to localStorage
  useEffect(() => {
    const userEvents = events.filter(e => userCreatedEventIds.includes(e.id));
    localStorage.setItem('userCreatedEvents', JSON.stringify(userEvents));
    localStorage.setItem('userCreatedEventIds', JSON.stringify(userCreatedEventIds));
  }, [events, userCreatedEventIds]);

  // Add event handler
  const addEvent = useCallback((eventData: {
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
  }): number => {
    const newId = Date.now();
    const newEvent: Event = {
      id: newId,
      title: eventData.title,
      category: eventData.category || "Events",
      organization: eventData.organization,
      location: eventData.location,
      date: eventData.date,
      time: eventData.time,
      isLive: false,
      food: eventData.food,
      price: eventData.price,
      dayOfWeek: getDayOfWeek(eventData.date),
      requiresRegistration: eventData.requiresRegistration,
      addedDate: new Date(),
      description: eventData.description,
      eventDate: new Date(eventData.date),
    };

    setEvents(prev => [newEvent, ...prev]);
    setUserCreatedEventIds(prev => [...prev, newId]);
    return newId;
  }, []);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["Events", "Clubs", "Academic"]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(["LAX", "Pollock", "TCF 1"]);
  const [selectedFoods, setSelectedFoods] = useState<string[]>(["Snacks", "Pizza"]);
  const [selectedDays, setSelectedDays] = useState<string[]>(["Monday", "Wednesday", "Thursday"]);
  const [priceRange, setPriceRange] = useState({ min: "", max: "" });
  const [dateRange, setDateRange] = useState<Date | undefined>(undefined);
  const [addedSince, setAddedSince] = useState<Date | undefined>(undefined);
  const [requiresRegistration, setRequiresRegistration] = useState(false);

  // Sort states
  const [sortBy, setSortBy] = useState<string>("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // School dropdown state
  const [selectedSchool, setSelectedSchool] = useState("University of Waterloo");

  // Food filter states
  const [includeFoods, setIncludeFoods] = useState(false);

  // Calendar popup states
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [showAddedSincePicker, setShowAddedSincePicker] = useState(false);

  // Sidebar state
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(true);

  // Pie menu hooks
  const categoryPieMenu = usePieMenu();
  const locationPieMenu = usePieMenu();
  const foodPieMenu = usePieMenu();
  const dayPieMenu = usePieMenu();
  const sortPieMenu = usePieMenu();

  // Easter eggs hook
  const { activeEasterEgg, clearEasterEgg, checkSearchQuery } = useEasterEggs();

  // Onboarding modal state
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Submit event modal state
  const [showSubmitEvent, setShowSubmitEvent] = useState(false);

  // Command palette state
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Profile/onboarding completion state
  const [profileCompleted, setProfileCompleted] = useState(false);

  // Saved and registered events state (persisted to localStorage)
  const [savedEventIds, setSavedEventIds] = useState<number[]>(() => {
    const saved = localStorage.getItem('savedEventIds');
    return saved ? JSON.parse(saved) : [];
  });
  const [registeredEventIds, setRegisteredEventIds] = useState<number[]>(() => {
    const registered = localStorage.getItem('registeredEventIds');
    return registered ? JSON.parse(registered) : [];
  });

  // Persist saved/registered to localStorage
  useEffect(() => {
    localStorage.setItem('savedEventIds', JSON.stringify(savedEventIds));
  }, [savedEventIds]);

  useEffect(() => {
    localStorage.setItem('registeredEventIds', JSON.stringify(registeredEventIds));
  }, [registeredEventIds]);

  // Event save/register handlers
  const toggleSaveEvent = useCallback((eventId: number) => {
    setSavedEventIds(prev =>
      prev.includes(eventId)
        ? prev.filter(id => id !== eventId)
        : [...prev, eventId]
    );
  }, []);

  const toggleRegisterEvent = useCallback((eventId: number) => {
    setRegisteredEventIds(prev =>
      prev.includes(eventId)
        ? prev.filter(id => id !== eventId)
        : [...prev, eventId]
    );
  }, []);

  // Saved filter for quick filter
  const [savedFilter, setSavedFilter] = useState(false);

  // Credits and promotions state (persisted to localStorage)
  const [userCredits, setUserCredits] = useState<number>(() => {
    const saved = localStorage.getItem('userCredits');
    return saved ? JSON.parse(saved) : 100; // Start with 100 free credits
  });
  const [promotedEvents, setPromotedEvents] = useState<PromotedEvent[]>(() => {
    const saved = localStorage.getItem('promotedEvents');
    return saved ? JSON.parse(saved) : [];
  });
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  // Persist credits and promotions to localStorage
  useEffect(() => {
    localStorage.setItem('userCredits', JSON.stringify(userCredits));
  }, [userCredits]);

  useEffect(() => {
    localStorage.setItem('promotedEvents', JSON.stringify(promotedEvents));
  }, [promotedEvents]);

  // Add credits handler
  const addCredits = useCallback((amount: number) => {
    setUserCredits(prev => prev + amount);
  }, []);

  // Promote event handler
  const promoteEvent = useCallback((eventId: number, packageId: string, credits: number, duration: number) => {
    // Check if user has enough credits
    if (userCredits < credits) {
      setShowBuyCredits(true);
      return false;
    }

    // Deduct credits
    setUserCredits(prev => prev - credits);

    // Add to promoted events
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

    setPromotedEvents(prev => [
      ...prev.filter(p => p.eventId !== eventId), // Remove existing promotion for this event
      {
        eventId,
        package: packageId as PromotedEvent['package'],
        startDate,
        endDate,
      },
    ]);

    return true;
  }, [userCredits]);

  // Check if event is currently promoted
  const isEventPromoted = useCallback((eventId: number) => {
    const now = new Date().toISOString();
    return promotedEvents.some(
      p => p.eventId === eventId && p.endDate > now
    );
  }, [promotedEvents]);

  // Get active promoted event IDs
  const activePromotedEventIds = useMemo(() => {
    const now = new Date().toISOString();
    return promotedEvents
      .filter(p => p.endDate > now)
      .map(p => p.eventId);
  }, [promotedEvents]);

  // Command+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Expanded sections state
  const [expandedSections, setExpandedSections] = useState({
    category: true,
    dateRange: false,
    location: false,
    priceRange: false,
    food: false,
    dayOfWeek: false,
    addedSince: false,
    registration: false,
    sort: false,
  });

  // JSON Editor state
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState("");

  // AI prompt state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isCalendar = target.closest("[data-calendar-picker]");
      const isTrigger = target.closest("button[data-calendar-trigger]");
      const isFilterDropdown = target.closest("[data-filter-dropdown]");
      const isFilterTrigger = target.closest("[data-filter-trigger]");
      const isPieMenu = target.closest("[data-pie-menu]");

      if (!isCalendar && !isTrigger) {
        setShowDateRangePicker(false);
        setShowAddedSincePicker(false);
      }

      // Don't close filter dropdown when clicking on pie menu
      if (!isFilterDropdown && !isFilterTrigger && !isPieMenu) {
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Update JSON when filters change
  useEffect(() => {
    const filterState: FilterState = {
      searchQuery,
      categories: selectedCategories,
      locations: selectedLocations,
      foods: selectedFoods,
      days: selectedDays,
      priceRange,
      dateRange: dateRange?.toISOString() || "",
      addedSince: addedSince?.toISOString() || "",
      requiresRegistration,
    };
    setJsonValue(JSON.stringify(filterState, null, 2));
  }, [
    searchQuery,
    selectedCategories,
    selectedLocations,
    selectedFoods,
    selectedDays,
    priceRange,
    dateRange,
    addedSince,
    requiresRegistration,
  ]);

  // Handle JSON editor changes
  const handleJsonChange = (value: string | undefined) => {
    if (!value) return;
    setJsonValue(value);

    try {
      const parsed: FilterState = JSON.parse(value);
      setJsonError("");
      setSearchQuery(parsed.searchQuery || "");
      setSelectedCategories(Array.isArray(parsed.categories) ? parsed.categories : []);
      setSelectedLocations(Array.isArray(parsed.locations) ? parsed.locations : []);
      setSelectedFoods(Array.isArray(parsed.foods) ? parsed.foods : []);
      setSelectedDays(Array.isArray(parsed.days) ? parsed.days : []);
      setPriceRange(parsed.priceRange || { min: "", max: "" });
      setDateRange(parsed.dateRange && parsed.dateRange.length > 0 ? new Date(parsed.dateRange) : undefined);
      setAddedSince(parsed.addedSince && parsed.addedSince.length > 0 ? new Date(parsed.addedSince) : undefined);
      setRequiresRegistration(parsed.requiresRegistration || false);
    } catch (e) {
      setJsonError("Invalid JSON format");
    }
  };

  // Section toggle - memoized with useCallback
  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Filter toggle functions - memoized with useCallback
  const toggleCategory = useCallback((cat: string) =>
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    ), []);

  const toggleLocation = useCallback((loc: string) =>
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    ), []);

  const toggleDay = useCallback((day: string) =>
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])), []);

  const toggleFood = useCallback((food: string) =>
    setSelectedFoods((prev) => (prev.includes(food) ? prev.filter((f) => f !== food) : [...prev, food])), []);

  // Clear all filters handler - memoized with useCallback
  const handleClearAllFilters = useCallback(() => {
    setSelectedCategories([]);
    setSelectedLocations([]);
    setSelectedFoods([]);
    setSelectedDays([]);
    setPriceRange({ min: "", max: "" });
    setDateRange(undefined);
    setAddedSince(undefined);
    setRequiresRegistration(false);
  }, []);

  // AI filter generation handler
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    // Check if user is signed in
    if (!profileCompleted) {
      setJsonError("Sign in to use AI filter generation.");
      return;
    }

    // Check if API key is configured
    if (!isApiKeyConfigured()) {
      setJsonError("OpenAI API key not configured. Add your key in src/lib/openai.ts");
      return;
    }

    setAiGenerating(true);
    setJsonError("");

    try {
      const newFilters = await generateFiltersWithAI(aiPrompt, (partialJson) => {
        // Update the editor with partial JSON as it streams in
        setJsonValue(partialJson);
      });
      // Apply the final parsed filters
      const generatedJson = JSON.stringify(newFilters, null, 2);
      setJsonValue(generatedJson);
      handleJsonChange(generatedJson);
    } catch (error) {
      console.error("AI generation error:", error);
      setJsonError(error instanceof Error ? error.message : "Failed to generate filters. Please try again.");
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, profileCompleted]);

  // Quick filter states
  const [todayFilter, setTodayFilter] = useState(false);
  const [thisWeekFilter, setThisWeekFilter] = useState(false);
  const [freeFilter, setFreeFilter] = useState(false);
  const [freeFoodFilter, setFreeFoodFilter] = useState(false);
  const [forYouFilter, setForYouFilter] = useState(false);

  // Filter events - memoized with useMemo
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Search query filter
      if (searchQuery && !event.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;

      // Saved filter - only show saved events
      if (savedFilter && !savedEventIds.includes(event.id)) return false;

      // Quick filters (these override the advanced filters when active)
      if (todayFilter && event.date !== "Today") return false;
      if (freeFilter && event.price !== 0) return false;
      if (freeFoodFilter && (event.food.length === 0 || event.price > 0)) return false;
      if (forYouFilter && profileCompleted && selectedCategories.length > 0 && !selectedCategories.includes(event.category)) return false;

      // Advanced filters (only apply when quick filters are not overriding)
      if (!todayFilter && !thisWeekFilter && selectedDays.length > 0 && !selectedDays.includes(event.dayOfWeek)) return false;
      if (!freeFilter && !freeFoodFilter) {
        if (priceRange.min && event.price < parseFloat(priceRange.min)) return false;
        if (priceRange.max && event.price > parseFloat(priceRange.max)) return false;
      }
      if (selectedLocations.length > 0 && !selectedLocations.some(loc => event.location.includes(loc))) return false;
      if (includeFoods && selectedFoods.length > 0 && !event.food.some(f => selectedFoods.includes(f))) return false;
      if (!forYouFilter && selectedCategories.length > 0 && !selectedCategories.includes(event.category)) return false;
      if (requiresRegistration && !event.requiresRegistration) return false;

      return true;
    });
  }, [
    events, searchQuery, todayFilter, freeFilter, freeFoodFilter, forYouFilter,
    thisWeekFilter, selectedDays, priceRange, selectedLocations,
    includeFoods, selectedFoods, selectedCategories, requiresRegistration, profileCompleted,
    savedFilter, savedEventIds
  ]);

  // Calculate filter count - memoized with useMemo
  const filterCount = useMemo(() =>
    selectedCategories.length +
    selectedLocations.length +
    selectedFoods.length +
    selectedDays.length +
    (priceRange.min || priceRange.max ? 1 : 0) +
    (dateRange ? 1 : 0) +
    (requiresRegistration ? 1 : 0),
    [selectedCategories, selectedLocations, selectedFoods, selectedDays, priceRange, dateRange, requiresRegistration]
  );

  // Memoized pie menu items to prevent recreation on every render
  const categoryPieItems = useMemo(() =>
    availableCategories.map((cat) => ({
      id: cat,
      label: cat,
      icon: <Tag className="w-4 h-4" />,
    })), []);

  const locationPieItems = useMemo(() =>
    availableLocations.map((loc) => ({
      id: loc,
      label: loc,
      icon: <MapPin className="w-4 h-4" />,
    })), []);

  const foodPieItems = useMemo(() =>
    availableFoods.map((food) => ({
      id: food,
      label: food,
      icon: <Utensils className="w-4 h-4" />,
    })), []);

  const dayPieItems = useMemo(() =>
    availableDays.map((day) => ({
      id: day,
      label: day,
      icon: <Calendar className="w-4 h-4" />,
    })), []);

  const sortPieItems = useMemo(() => [
    { id: "date", label: "Date", icon: <CalendarDays className="w-4 h-4" /> },
    { id: "title", label: "Title", icon: <Tag className="w-4 h-4" /> },
    { id: "location", label: "Location", icon: <MapPin className="w-4 h-4" /> },
    { id: "price", label: "Price", icon: <ArrowUpDown className="w-4 h-4" /> },
  ], []);

  return (
    <TooltipProvider delayDuration={0}>
    <div className="bg-white h-dvh flex flex-col">
      {/* Easter Eggs */}
      <EasterEggs activeEasterEgg={activeEasterEgg} onComplete={clearEasterEgg} />

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onComplete={(data) => {
          console.log("Onboarding completed:", data);
          setSelectedSchool(data.school);
          setProfileCompleted(true);
        }}
      />

      {/* Getting Started Checklist - only show when signed in */}
      {profileCompleted && (
        <GettingStartedChecklist
          onOpenOnboarding={() => setShowOnboarding(true)}
          onNavigateToFilters={() => setShowFilterDropdown(true)}
          onViewEvent={() => {
            // Auto-scroll to first event card
            const firstCard = document.querySelector('[data-event-card]');
            firstCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          profileCompleted={profileCompleted}
        />
      )}

      {/* Submit Event Modal */}
      <SubmitEventModal
        isOpen={showSubmitEvent}
        onClose={() => setShowSubmitEvent(false)}
        onSubmit={(eventData) => {
          // Add the event to the events list and return the ID
          const eventId = addEvent(eventData);
          console.log("New event created with ID:", eventId);
          return eventId;
        }}
        userCredits={userCredits}
        onPromote={promoteEvent}
        onBuyCredits={() => setShowBuyCredits(true)}
      />

      {/* Buy Credits Modal */}
      <BuyCreditsModal
        isOpen={showBuyCredits}
        onClose={() => setShowBuyCredits(false)}
        currentCredits={userCredits}
        onPurchase={addCredits}
      />

      {/* Command Palette Modal */}
      <CommandDialog
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        title="Command Palette"
        description="Search for commands, actions, and settings"
      >
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Search Section */}
          <CommandGroup heading="Search">
            <CommandItem
              onSelect={() => {
                setShowCommandPalette(false);
                // Focus the main search input
                const searchInput = document.querySelector('input[placeholder="Search events, clubs, activities..."]') as HTMLInputElement;
                searchInput?.focus();
              }}
            >
              <Search className="mr-2 h-4 w-4" />
              <span>Search Events</span>
              <CommandShortcut>/</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setTodayFilter(true);
                setShowCommandPalette(false);
              }}
            >
              <Clock className="mr-2 h-4 w-4" />
              <span>Show Today's Events</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setFreeFilter(true);
                setShowCommandPalette(false);
              }}
            >
              <Tag className="mr-2 h-4 w-4" />
              <span>Show Free Events</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Commands Section */}
          <CommandGroup heading="Commands">
            <CommandItem
              onSelect={() => {
                setShowFilterDropdown(true);
                setShowCommandPalette(false);
              }}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              <span>Open Filters</span>
              <CommandShortcut>F</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setViewMode("grid");
                setShowCommandPalette(false);
              }}
            >
              <Grid3x3 className="mr-2 h-4 w-4" />
              <span>Grid View</span>
              <CommandShortcut>G</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setViewMode("map");
                setShowCommandPalette(false);
              }}
            >
              <MapIcon className="mr-2 h-4 w-4" />
              <span>Map View</span>
              <CommandShortcut>M</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setViewMode("calendar");
                setShowCommandPalette(false);
              }}
            >
              <Calendar className="mr-2 h-4 w-4" />
              <span>Calendar View</span>
              <CommandShortcut>C</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Actions Section */}
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                setShowSubmitEvent(true);
                setShowCommandPalette(false);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              <span>Create New Event</span>
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setPageMode("myEvents");
                setShowCommandPalette(false);
              }}
            >
              <Megaphone className="mr-2 h-4 w-4" />
              <span>View My Events</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                // Clear all filters
                setSearchQuery("");
                setTodayFilter(false);
                setThisWeekFilter(false);
                setFreeFilter(false);
                setFreeFoodFilter(false);
                setForYouFilter(false);
                setSelectedCategories([]);
                setSelectedLocations([]);
                setSelectedFoods([]);
                setSelectedDays([]);
                setPriceRange({ min: "", max: "" });
                setShowCommandPalette(false);
              }}
            >
              <X className="mr-2 h-4 w-4" />
              <span>Clear All Filters</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Personal Section */}
          <CommandGroup heading="Personal">
            {profileCompleted ? (
              <>
                <CommandItem
                  onSelect={() => {
                    setForYouFilter(true);
                    setShowCommandPalette(false);
                  }}
                >
                  <Star className="mr-2 h-4 w-4" />
                  <span>Show Personalized Events</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setPageMode("myEvents");
                    setShowCommandPalette(false);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  <span>My Created Events</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    // Navigate to saved events (placeholder)
                    setShowCommandPalette(false);
                  }}
                >
                  <Heart className="mr-2 h-4 w-4" />
                  <span>Saved Events</span>
                </CommandItem>
              </>
            ) : (
              <CommandItem
                onSelect={() => {
                  setShowOnboarding(true);
                  setShowCommandPalette(false);
                }}
              >
                <LogIn className="mr-2 h-4 w-4" />
                <span>Sign In to Unlock Features</span>
              </CommandItem>
            )}
          </CommandGroup>

          <CommandSeparator />

          {/* Personal Settings Section */}
          <CommandGroup heading="Personal Settings">
            <CommandItem
              onSelect={() => {
                setShowOnboarding(true);
                setShowCommandPalette(false);
              }}
            >
              <User className="mr-2 h-4 w-4" />
              <span>{profileCompleted ? "Edit Profile" : "Create Profile"}</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                // Notification settings placeholder
                setShowCommandPalette(false);
              }}
            >
              <Bell className="mr-2 h-4 w-4" />
              <span>Notification Preferences</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                // Theme settings placeholder
                setShowCommandPalette(false);
              }}
            >
              <Palette className="mr-2 h-4 w-4" />
              <span>Theme & Appearance</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                // Privacy settings placeholder
                setShowCommandPalette(false);
              }}
            >
              <Shield className="mr-2 h-4 w-4" />
              <span>Privacy Settings</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setPageMode("about");
                setShowCommandPalette(false);
              }}
            >
              <HelpCircle className="mr-2 h-4 w-4" />
              <span>Help & Support</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Top Navigation */}
      <header
        className="flex items-center justify-between"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "48px",
          paddingLeft: "20px",
          paddingRight: "20px",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: "#fff",
          zIndex: 50,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-6 w-6 flex-shrink-0">
            <img alt="Logo" className="w-full h-full object-cover rounded" src={imgImage1} />
          </div>
          <span className="text-gray-300 text-lg font-light">/</span>
          <SchoolCombobox value={selectedSchool} onChange={setSelectedSchool} />
        </div>

        {profileCompleted ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setProfileCompleted(false)}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-sm px-3 py-1.5 rounded transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" strokeWidth={2.5} />
                Log out
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sign out of your account</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowOnboarding(true)}
                className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white font-medium text-sm px-3 py-1.5 rounded transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4" strokeWidth={2.5} />
                Sign in
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sign in to save preferences</p>
            </TooltipContent>
          </Tooltip>
        )}
      </header>

      <div className="flex overflow-hidden flex-1">
        {/* Side Navigation */}
        <aside
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
          className="flex flex-col transition-all duration-200 overflow-hidden"
          style={{
            position: "fixed",
            left: 0,
            top: "48px",
            bottom: 0,
            width: sidebarHovered ? "180px" : "48px",
            borderRight: "1px solid #e5e7eb",
            backgroundColor: "#fff",
            zIndex: 40,
          }}
        >
          <div className="p-2">
            <nav className="flex flex-col gap-1">
              {/* Command Palette Trigger - Above Events */}
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full font-medium text-[11px] rounded text-left flex items-center px-2 py-1.5 gap-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 mb-1"
              >
                <Search className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                <span
                  className="flex-1 whitespace-nowrap transition-opacity duration-150"
                  style={{ opacity: sidebarHovered ? 1 : 0 }}
                >
                  Search
                </span>
                {sidebarHovered && (
                  <div className="flex items-center gap-0.5">
                    <span className="flex items-center justify-center w-5 h-5 bg-gray-100 border border-gray-300 rounded shadow-sm text-[10px] text-gray-500">
                      ⌘
                    </span>
                    <span className="flex items-center justify-center w-5 h-5 bg-gray-100 border border-gray-300 rounded shadow-sm text-[10px] text-gray-500">
                      K
                    </span>
                  </div>
                )}
              </button>

              {/* Events Expandable Section */}
              <div
                className="rounded"
                style={{
                  backgroundColor: pageMode === "events" ? "#f3f4f6" : "transparent",
                }}
              >
                  <button
                  onClick={() => setEventsExpanded(!eventsExpanded)}
                  className={`w-full font-medium text-[11px] rounded text-left flex items-center px-2 py-1.5 gap-2 ${
                    pageMode === "events" ? "text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                  <span className="flex-1 whitespace-nowrap transition-opacity duration-150" style={{ opacity: sidebarHovered ? 1 : 0 }}>
                    Events
                  </span>
                  {sidebarHovered && (
                    <ChevronDown
                      className="w-3 h-3 flex-shrink-0 transition-transform duration-200"
                      style={{
                        transform: eventsExpanded ? "rotate(0deg)" : "rotate(-90deg)"
                      }}
                      strokeWidth={2}
                    />
                  )}
                </button>

                {/* Sublinks */}
                <div
                  className="overflow-hidden transition-all duration-200"
                  style={{
                    maxHeight: eventsExpanded ? "120px" : "0px",
                    opacity: eventsExpanded ? 1 : 0
                  }}
                >
                  <div className="flex flex-col gap-0.5 mt-0.5" style={{ paddingLeft: sidebarHovered ? "20px" : "0px" }}>
                    <button
                      onClick={() => setPageMode("events")}
                      className={`font-medium text-[11px] rounded text-left flex items-center px-2 py-1.5 gap-2 ${
                        pageMode === "events" ? "text-blue-600" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                      }`}
                    >
                      <Compass className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                      <span className="whitespace-nowrap transition-opacity duration-150" style={{ opacity: sidebarHovered ? 1 : 0 }}>
                        Explore
                      </span>
                    </button>
                    <button
                      onClick={() => setShowSubmitEvent(true)}
                      className="font-medium text-[11px] rounded text-left flex items-center px-2 py-1.5 gap-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    >
                      <Plus className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                      <span className="whitespace-nowrap transition-opacity duration-150" style={{ opacity: sidebarHovered ? 1 : 0 }}>
                        Create
                      </span>
                    </button>
                    <button
                      onClick={() => setPageMode("myEvents")}
                      className={`font-medium text-[11px] rounded text-left flex items-center px-2 py-1.5 gap-2 ${
                        pageMode === "myEvents" ? "text-blue-600" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                      }`}
                    >
                      <Megaphone className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                      <span className="whitespace-nowrap transition-opacity duration-150" style={{ opacity: sidebarHovered ? 1 : 0 }}>
                        My Events
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <NavButton icon={Users} label="Clubs" expanded={sidebarHovered} />
              <NavButton
                icon={Info}
                label="About"
                isActive={pageMode === "about"}
                onClick={() => setPageMode("about")}
                expanded={sidebarHovered}
              />
              <NavButton icon={Mail} label="Contact" expanded={sidebarHovered} />
            </nav>
          </div>

        </aside>

        {/* Main Content */}
        <div
          className="flex-1 overflow-auto"
          style={{
            marginLeft: "48px",
            marginTop: "48px",
            padding: "24px",
            minHeight: "calc(100vh - 48px)",
          }}
        >
          {pageMode === "about" ? (
            <AboutPage />
          ) : pageMode === "myEvents" ? (
            <MyEventsView
              profileCompleted={profileCompleted}
              onSignIn={() => setShowOnboarding(true)}
              events={events}
              savedEventIds={savedEventIds}
              registeredEventIds={registeredEventIds}
              onToggleSave={toggleSaveEvent}
              onToggleRegister={toggleRegisterEvent}
            />
          ) : (
            <div className="space-y-5">
              {/* Search and Quick Filters - Always Visible */}
              <div className="space-y-5">
                {/* Search Bar with View Mode Tabs */}
                <div className="flex gap-3 items-stretch">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search events, clubs, activities..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        checkSearchQuery(e.target.value);
                      }}
                      className="w-full border border-gray-200 rounded pl-9 pr-3 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* View Mode Toggle - Moved here */}
                  <div className="bg-gray-100 flex items-stretch p-0.5 rounded gap-0.5">
                    <ViewModeButton
                      icon={Grid3x3}
                      label="Grid"
                      isActive={viewMode === "grid"}
                      onClick={() => setViewMode("grid")}
                    />
                    <ViewModeButton
                      icon={MapIcon}
                      label="Map"
                      isActive={viewMode === "map"}
                      onClick={() => setViewMode("map")}
                    />
                    <ViewModeButton
                      icon={Calendar}
                      label="Calendar"
                      isActive={viewMode === "calendar"}
                      onClick={() => setViewMode("calendar")}
                    />
                  </div>
                </div>

                {/* Quick Filter Chips */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Event Count */}
                  <span className="font-bold text-xl text-gray-900">
                    {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}
                  </span>

                  {/* Filters - Right aligned */}
                  <div className="flex flex-wrap items-center gap-2">

                  <QuickFilterChip
                    icon={<Clock className="w-3.5 h-3.5" />}
                    label="Today"
                    active={todayFilter}
                    onClick={() => {
                      setTodayFilter(!todayFilter);
                      if (!todayFilter) setThisWeekFilter(false);
                    }}
                  />
                  <QuickFilterChip
                    icon={<Utensils className="w-3.5 h-3.5" />}
                    label="Free Food"
                    active={freeFoodFilter}
                    onClick={() => {
                      setFreeFoodFilter(!freeFoodFilter);
                      if (!freeFoodFilter) setFreeFilter(false);
                    }}
                  />
                  <QuickFilterChip
                    icon={<Sparkles className="w-3.5 h-3.5" />}
                    label="For You"
                    active={forYouFilter}
                    onClick={() => setForYouFilter(!forYouFilter)}
                    disabled={!profileCompleted}
                    tooltip={!profileCompleted ? "Sign in to enable personalized recommendations" : undefined}
                  />
                  <QuickFilterChip
                    icon={<Heart className="w-3.5 h-3.5" />}
                    label="Saved"
                    active={savedFilter}
                    onClick={() => setSavedFilter(!savedFilter)}
                    badge={savedEventIds.length > 0 ? savedEventIds.length : undefined}
                  />

                  {/* More Filters Button with Dropdown */}
                  <div className="relative">
                    <button
                      data-filter-trigger
                      onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all cursor-pointer ${
                        showFilterDropdown || filterCount > 0
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      More Filters
                      {filterCount > 0 && (
                        <span
                          className="bg-blue-500 text-white px-1.5 py-0.5 rounded-full text-[10px] ml-1 flex items-center gap-1 hover:bg-blue-600 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCategories([]);
                            setSelectedLocations([]);
                            setSelectedFoods([]);
                            setSelectedDays([]);
                            setPriceRange({ min: "", max: "" });
                            setDateRange(undefined);
                            setAddedSince(undefined);
                            setRequiresRegistration(false);
                          }}
                        >
                          <X className="w-2.5 h-2.5" strokeWidth={3} />
                          {filterCount}
                        </span>
                      )}
                    </button>

                    {/* Filter Dropdown - Positioned below More Filters button, aligned right */}
                    {showFilterDropdown && (
                      <div
                        data-filter-dropdown
                        className="rounded overflow-y-auto absolute right-0 top-full mt-2 z-50 px-4 py-4 max-h-[calc(100vh-200px)]"
                        style={{ width: "300px", backgroundColor: "#fff", border: "1px solid #e5e7eb" }}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="font-bold text-base text-gray-900">Filters</h2>
                          <div className="flex gap-1 bg-gray-100 rounded p-0.5">
                            <button
                              onClick={() => setFilterViewMode("visual")}
                              className={`${
                                filterViewMode === "visual"
                                  ? "bg-white text-gray-900 shadow-sm"
                                  : "bg-transparent text-gray-500 hover:text-gray-900"
                              } font-medium text-[11px] px-3 py-1 rounded transition-all`}
                            >
                              Visual
                            </button>
                            <button
                              onClick={() => setFilterViewMode("json")}
                              className={`${
                                filterViewMode === "json"
                                  ? "bg-white text-gray-900 shadow-sm"
                                  : "bg-transparent text-gray-500 hover:text-gray-900"
                              } font-medium text-[11px] px-3 py-1 rounded transition-all`}
                            >
                              JSON
                            </button>
                          </div>
                        </div>

                        {filterViewMode === "visual" ? (
                          <>
                            <div className="-space-y-px">
                              {/* Category */}
                              <FilterSection
                                title="Category"
                                expanded={expandedSections.category}
                                onToggle={() => toggleSection("category")}
                                indicator={selectedCategories.length > 0 ? `${selectedCategories.length}` : undefined}
                                onClear={() => setSelectedCategories([])}
                              >
                                <div className="relative">
                                  <button
                                    onClick={categoryPieMenu.open}
                                    className="bg-gray-100 font-medium text-gray-600 text-xs px-3 py-2 rounded w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                  >
                                    <span>
                                      {selectedCategories.length > 0
                                        ? selectedCategories.join(", ")
                                        : "Select Categories"}
                                    </span>
                                    <Tag className="w-4 h-4 text-gray-400" />
                                  </button>
                                  <PieMenu
                                    items={categoryPieItems}
                                    isOpen={categoryPieMenu.isOpen}
                                    position={categoryPieMenu.position}
                                    onClose={categoryPieMenu.close}
                                    onSelect={(item) => toggleCategory(item.id)}
                                    selectedIds={selectedCategories}
                                    closeOnSelect={false}
                                    radius={140}
                                    innerRadius={20}
                                  />
                                </div>
                              </FilterSection>

                              {/* Date Range */}
                              <FilterSection
                                title="Date range"
                                expanded={expandedSections.dateRange}
                                onToggle={() => toggleSection("dateRange")}
                                indicator={dateRange ? "1" : undefined}
                                onClear={() => setDateRange(undefined)}
                              >
                                <div className="relative">
                                  <button
                                    data-calendar-trigger
                                    onClick={() => setShowDateRangePicker(!showDateRangePicker)}
                                    className="bg-gray-100 font-medium text-gray-600 text-xs px-3 py-2 rounded w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between"
                                  >
                                    <span>
                                      {dateRange
                                        ? dateRange.toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                          })
                                        : "Select Date"}
                                    </span>
                                    <CalendarDays className="w-4 h-4 text-gray-400" />
                                  </button>
                                  {showDateRangePicker && (
                                    <div className="absolute z-50 mt-2">
                                      <DatePicker
                                        selected={dateRange}
                                        onSelect={(date) => setDateRange(date)}
                                        onClose={() => setShowDateRangePicker(false)}
                                      />
                                    </div>
                                  )}
                                </div>
                              </FilterSection>

                              {/* Location */}
                              <FilterSection
                                title="Location"
                                expanded={expandedSections.location}
                                onToggle={() => toggleSection("location")}
                                indicator={selectedLocations.length > 0 ? `${selectedLocations.length}` : undefined}
                                onClear={() => setSelectedLocations([])}
                              >
                                <div className="relative">
                                  <button
                                    onClick={locationPieMenu.open}
                                    className="bg-gray-100 font-medium text-gray-600 text-xs px-3 py-2 rounded w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                  >
                                    <span>
                                      {selectedLocations.length > 0
                                        ? selectedLocations.join(", ")
                                        : "Select Locations"}
                                    </span>
                                    <MapPin className="w-4 h-4 text-gray-400" />
                                  </button>
                                  <PieMenu
                                    items={locationPieItems}
                                    isOpen={locationPieMenu.isOpen}
                                    position={locationPieMenu.position}
                                    onClose={locationPieMenu.close}
                                    onSelect={(item) => toggleLocation(item.id)}
                                    selectedIds={selectedLocations}
                                    closeOnSelect={false}
                                    radius={140}
                                    innerRadius={20}
                                  />
                                </div>
                              </FilterSection>

                              {/* Price Range */}
                              <FilterSection
                                title="Price range"
                                expanded={expandedSections.priceRange}
                                onToggle={() => toggleSection("priceRange")}
                                indicator={priceRange.min || priceRange.max ? "1" : undefined}
                                onClear={() => setPriceRange({ min: "", max: "" })}
                              >
                                <div className="flex gap-2 items-center w-full">
                                  <input
                                    type="number"
                                    placeholder="Min"
                                    value={priceRange.min}
                                    onChange={(e) => setPriceRange((prev) => ({ ...prev, min: e.target.value }))}
                                    className="w-0 flex-1 min-w-0 border border-gray-200 rounded px-2.5 py-2 text-xs placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                  />
                                  <span className="text-gray-400 text-[11px] flex-shrink-0">to</span>
                                  <input
                                    type="number"
                                    placeholder="Max"
                                    value={priceRange.max}
                                    onChange={(e) => setPriceRange((prev) => ({ ...prev, max: e.target.value }))}
                                    className="w-0 flex-1 min-w-0 border border-gray-200 rounded px-2.5 py-2 text-xs placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                  />
                                </div>
                              </FilterSection>

                              {/* Food */}
                              <FilterSection
                                title="Food"
                                expanded={expandedSections.food}
                                onToggle={() => toggleSection("food")}
                                indicator={selectedFoods.length > 0 ? `${selectedFoods.length}` : undefined}
                                onClear={() => setSelectedFoods([])}
                              >
                                <div className="relative">
                                  <button
                                    onClick={foodPieMenu.open}
                                    className="bg-gray-100 font-medium text-gray-600 text-xs px-3 py-2 rounded w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                  >
                                    <span>
                                      {selectedFoods.length > 0
                                        ? selectedFoods.join(", ")
                                        : "Select Food Options"}
                                    </span>
                                    <Utensils className="w-4 h-4 text-gray-400" />
                                  </button>
                                  <PieMenu
                                    items={foodPieItems}
                                    isOpen={foodPieMenu.isOpen}
                                    position={foodPieMenu.position}
                                    onClose={foodPieMenu.close}
                                    onSelect={(item) => toggleFood(item.id)}
                                    selectedIds={selectedFoods}
                                    closeOnSelect={false}
                                    radius={140}
                                    innerRadius={20}
                                  />
                                </div>
                              </FilterSection>

                              {/* Day of the week */}
                              <FilterSection
                                title="Day of the week"
                                expanded={expandedSections.dayOfWeek}
                                onToggle={() => toggleSection("dayOfWeek")}
                                indicator={selectedDays.length > 0 ? `${selectedDays.length}` : undefined}
                                onClear={() => setSelectedDays([])}
                              >
                                <div className="relative">
                                  <button
                                    onClick={dayPieMenu.open}
                                    className="bg-gray-100 font-medium text-gray-600 text-xs px-3 py-2 rounded w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                  >
                                    <span>
                                      {selectedDays.length > 0
                                        ? selectedDays.join(", ")
                                        : "Select Days"}
                                    </span>
                                    <Calendar className="w-4 h-4 text-gray-400" />
                                  </button>
                                  <PieMenu
                                    items={dayPieItems}
                                    isOpen={dayPieMenu.isOpen}
                                    position={dayPieMenu.position}
                                    onClose={dayPieMenu.close}
                                    onSelect={(item) => toggleDay(item.id)}
                                    selectedIds={selectedDays}
                                    closeOnSelect={false}
                                    radius={140}
                                    innerRadius={20}
                                  />
                                </div>
                              </FilterSection>

                              {/* Added since */}
                              <FilterSection
                                title="Added since"
                                expanded={expandedSections.addedSince}
                                onToggle={() => toggleSection("addedSince")}
                                indicator={addedSince ? "1" : undefined}
                                onClear={() => setAddedSince(undefined)}
                              >
                                <div className="relative">
                                  <button
                                    data-calendar-trigger
                                    onClick={() => setShowAddedSincePicker(!showAddedSincePicker)}
                                    className="bg-gray-100 font-medium text-gray-600 text-xs px-3 py-2 rounded w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between"
                                  >
                                    <span>
                                      {addedSince
                                        ? addedSince.toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                          })
                                        : "Select Date"}
                                    </span>
                                    <CalendarDays className="w-4 h-4 text-gray-400" />
                                  </button>
                                  {showAddedSincePicker && (
                                    <div className="absolute z-50 mt-2">
                                      <DatePicker
                                        selected={addedSince}
                                        onSelect={(date) => setAddedSince(date)}
                                        onClose={() => setShowAddedSincePicker(false)}
                                      />
                                    </div>
                                  )}
                                </div>
                              </FilterSection>

                              {/* Registration Required */}
                              <FilterSection
                                title="Registration required"
                                expanded={expandedSections.registration}
                                onToggle={() => toggleSection("registration")}
                                indicator={requiresRegistration ? "1" : undefined}
                                onClear={() => setRequiresRegistration(false)}
                              >
                                <Checkbox
                                  checked={requiresRegistration}
                                  onChange={() => setRequiresRegistration(!requiresRegistration)}
                                />
                              </FilterSection>

                              {/* Sort Section */}
                              <div className="mt-4 mb-3">
                                <h3 className="font-bold text-base text-gray-900">Sort</h3>
                              </div>

                              <FilterSection
                                title="Sort By"
                                expanded={expandedSections.sort}
                                onToggle={() => toggleSection("sort")}
                                indicator={
                                  sortBy
                                    ? `${sortBy.charAt(0).toUpperCase() + sortBy.slice(1)} ${sortOrder === "asc" ? "↑" : "↓"}`
                                    : undefined
                                }
                                onClear={() => {
                                  setSortBy("");
                                  setSortOrder("desc");
                                }}
                              >
                                <div className="space-y-2">
                                  <div className="relative">
                                    <button
                                      onClick={sortPieMenu.open}
                                      className="bg-gray-100 font-medium text-gray-600 text-xs px-3 py-2 rounded w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                    >
                                      <span>
                                        {sortBy
                                          ? sortBy.charAt(0).toUpperCase() + sortBy.slice(1)
                                          : "Select Sort Field"}
                                      </span>
                                      <ArrowUpDown className="w-4 h-4 text-gray-400" />
                                    </button>
                                    <PieMenu
                                      items={sortPieItems}
                                      isOpen={sortPieMenu.isOpen}
                                      position={sortPieMenu.position}
                                      onClose={sortPieMenu.close}
                                      onSelect={(item) => setSortBy(item.id)}
                                      selectedIds={sortBy ? [sortBy] : []}
                                      closeOnSelect={true}
                                      radius={140}
                                      innerRadius={20}
                                    />
                                  </div>

                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setSortOrder("asc")}
                                      className={`flex-1 px-2 py-1.5 rounded text-[11px] font-medium transition-all ${
                                        sortOrder === "asc"
                                          ? "bg-blue-500 text-white"
                                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                      }`}
                                    >
                                      Ascending
                                    </button>
                                    <button
                                      onClick={() => setSortOrder("desc")}
                                      className={`flex-1 px-2 py-1.5 rounded text-[11px] font-medium transition-all ${
                                        sortOrder === "desc"
                                          ? "bg-blue-500 text-white"
                                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                      }`}
                                    >
                                      Descending
                                    </button>
                                  </div>
                                </div>
                              </FilterSection>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-4">
                            <p className="text-gray-500 text-[11px] leading-relaxed">
                              Use AI to generate filters or edit the JSON directly. Changes apply automatically.
                            </p>
                            {/* AI Prompt Input */}
                            <div className="relative">
                              <input
                                type="text"
                                placeholder={aiGenerating ? "Generating..." : "Describe filters and press Enter..."}
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && aiPrompt.trim() && !aiGenerating) {
                                    handleAiGenerate();
                                  }
                                }}
                                disabled={aiGenerating}
                                className="w-full bg-gray-100 text-gray-700 text-xs px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400 disabled:opacity-60"
                              />
                              {aiGenerating && (
                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                  <div className="w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                                </div>
                              )}
                            </div>
                            {jsonError && (
                              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-[11px]">
                                {jsonError}
                              </div>
                            )}
                            <div className="border-y border-gray-200 overflow-hidden -mx-4">
                              <Suspense fallback={
                                <div className="flex items-center justify-center h-[250px] bg-gray-50">
                                  <div className="text-gray-500 text-sm">Loading editor...</div>
                                </div>
                              }>
                                <Editor
                                  height="250px"
                                  defaultLanguage="json"
                                  value={jsonValue}
                                  onChange={handleJsonChange}
                                  theme="vs-light"
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
                    )}
                  </div>
                  </div>
                </div>
              </div>

              {/* Main Content */}
              <main className="w-full">
                {viewMode === "grid" && (
                  filteredEvents.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {/* Sort promoted events to the top */}
                      {[...filteredEvents]
                        .sort((a, b) => {
                          const aPromoted = activePromotedEventIds.includes(a.id);
                          const bPromoted = activePromotedEventIds.includes(b.id);
                          if (aPromoted && !bPromoted) return -1;
                          if (!aPromoted && bPromoted) return 1;
                          return 0;
                        })
                        .map((event) => (
                        <EventCard
                          key={event.id}
                          event={event}
                          isSaved={savedEventIds.includes(event.id)}
                          isRegistered={registeredEventIds.includes(event.id)}
                          isPromoted={activePromotedEventIds.includes(event.id)}
                          onToggleSave={toggleSaveEvent}
                          onToggleRegister={toggleRegisterEvent}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-24 px-4">
                      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                        <Search className="w-8 h-8 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">No events found</h3>
                      <p className="text-sm text-gray-500 text-center max-w-md mb-6">
                        We couldn't find any events matching your current filters. Try adjusting your search or clearing some filters.
                      </p>
                      <button
                        onClick={handleClearAllFilters}
                        className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition-colors"
                      >
                        Clear all filters
                      </button>
                    </div>
                  )
                )}
                {viewMode === "calendar" && (
                  <div className="text-center py-32 text-gray-500">Calendar view coming soon...</div>
                )}
                {viewMode === "map" && (
                  <div className="text-center py-32 text-gray-500">Map view coming soon...</div>
                )}
              </main>
            </div>
          )}
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

// Helper Components
function NavButton({
  icon: Icon,
  label,
  isActive = false,
  onClick,
  expanded,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  expanded: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`font-medium text-[11px] rounded text-left flex items-center px-2 py-1.5 gap-2 w-full cursor-pointer ${
        isActive ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
      <span className="whitespace-nowrap transition-opacity duration-150" style={{ opacity: expanded ? 1 : 0 }}>
        {label}
      </span>
    </button>
  );
}

function ViewModeButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`${
        isActive ? "bg-white shadow-sm" : "bg-transparent hover:bg-white/50"
      } font-medium text-[11px] text-gray-900 px-2.5 py-1 rounded transition-all flex items-center gap-1 cursor-pointer h-full`}
    >
      <Icon className="w-3 h-3" strokeWidth={2} />
      <span className="leading-none">{label}</span>
    </button>
  );
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-5 h-5 border-2 ${
        checked ? "border-blue-500 bg-blue-500" : "border-gray-300 bg-white"
      } rounded transition-all flex items-center justify-center hover:border-blue-500 cursor-pointer`}
    >
      {checked && (
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

function QuickFilterChip({
  icon,
  label,
  active,
  onClick,
  highlight = false,
  disabled = false,
  tooltip,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
  disabled?: boolean;
  tooltip?: string;
  badge?: number;
}) {
  const button = (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
        disabled
          ? "bg-gray-100 text-gray-400"
          : active
          ? "bg-blue-100 text-blue-700"
          : highlight
          ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
          active ? "bg-blue-200 text-blue-800" : "bg-gray-200 text-gray-700"
        }`}>
          {badge}
        </span>
      )}
    </button>
  );

  if (tooltip && disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{button}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
