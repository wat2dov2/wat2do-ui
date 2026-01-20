import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  Suspense,
  lazy,
} from "react";
import {
  Routes,
  Route,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
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
  SlidersHorizontal,
  Target,
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
  Settings,
  Sun,
  Moon,
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
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { OnboardingModal } from "@/components/OnboardingModal";
import { FilterTag } from "@/components/Dropdown";
import { QRCodeDetailsModal } from "@/components/QRCodeDetailsModal";

// Lazy load pages for code splitting
const AboutPage = lazy(() => import("@/components/AboutPage").then(module => ({ default: module.AboutPage })));
const ClubsPage = lazy(() => import("@/components/ClubsPage").then(module => ({ default: module.ClubsPage })));
const AdminPanel = lazy(() => import("@/components/AdminPanel").then(module => ({ default: module.AdminPanel })));
const AdminEventsPage = lazy(() => import("@/components/AdminEventsPage").then(module => ({ default: module.AdminEventsPage })));
const AdminClubsPage = lazy(() => import("@/components/AdminClubsPage").then(module => ({ default: module.AdminClubsPage })));
const AdminSubmissionsPage = lazy(() => import("@/components/AdminSubmissionsPage").then(module => ({ default: module.AdminSubmissionsPage })));
const AdminPostersPage = lazy(() => import("@/components/AdminPostersPage").then(module => ({ default: module.AdminPostersPage })));
const MarketingPage = lazy(() => import("@/components/MarketingPage").then(module => ({ default: module.MarketingPage })));
const MyEventsView = lazy(() => import("@/components/MyEventsView").then(module => ({ default: module.MyEventsView })));

// Lazy load Monaco Editor (3.6MB) - only needed for JSON filter view
const Editor = lazy(() => import("@monaco-editor/react"));
import { DatePicker } from "@/components/DatePicker";
import { FilterSection } from "@/components/FilterSection";
import { EventCard } from "@/components/EventCard";
import { EventList } from "@/components/EventList";
import { EventListSkeleton } from "@/components/ui/skeleton";
import { GettingStartedChecklist } from "@/components/GettingStartedChecklist";
import { SubmitEventModal } from "@/components/SubmitEventModal";
import { SchoolCombobox } from "@/components/SchoolCombobox";
import { AnimatedThemeToggler } from "@/components/AnimatedThemeToggler";
import { PieMenu } from "@/components/ui/pie-menu";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { usePieMenu } from "@/hooks/usePieMenu";
import { useEasterEggs } from "@/hooks/useEasterEggs";
import { EasterEggs } from "@/components/EasterEggs";
import type {
  ViewMode,
  FilterViewMode,
  PageMode,
  FilterState,
  PromotedEvent,
  Event,
} from "@/types";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { generateFiltersWithAI, isApiKeyConfigured } from "@/lib/openai";
import {
  mockEvents,
  availableCategories,
  availableLocations,
  availableDays,
  availableFoods,
} from "@/data/events";
import { getQRCodeById, handleQRRedirect } from "@/utils/qrRedirect";
import { addConversionAction } from "@/utils/qrRedirect";

// Helper to get day of week from date string
const getDayOfWeek = (dateStr: string): string => {
  const date = new Date(dateStr);
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[date.getDay()];
};

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Determine current page from route
  const currentPath = location.pathname;
  const pageMode: PageMode = 
    currentPath === "/clubs" ? "clubs" :
    currentPath === "/about" ? "about" :
    currentPath === "/my-events" ? "myEvents" :
    currentPath.startsWith("/admin/events") ? "admin-events" :
    currentPath.startsWith("/admin/clubs") ? "admin-clubs" :
    currentPath.startsWith("/admin/submissions") ? "admin-submissions" :
    currentPath.startsWith("/admin/posters") ? "admin-posters" :
    currentPath.startsWith("/admin") ? "admin" :
    currentPath === "/marketing" ? "marketing" :
    "events";
  
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filterViewMode, setFilterViewMode] = useState<FilterViewMode>(
    "visual"
  );

  // Events state (combines mock events with user-created events)
  const [events, setEvents] = useState<Event[]>(() => {
    const savedEvents = localStorage.getItem("userCreatedEvents");
    const userEvents: Event[] = savedEvents ? JSON.parse(savedEvents) : [];
    return [...mockEvents, ...userEvents];
  });

  // Track user-created event IDs separately for persistence
  const [userCreatedEventIds, setUserCreatedEventIds] = useState<number[]>(
    () => {
      const saved = localStorage.getItem("userCreatedEventIds");
      return saved ? JSON.parse(saved) : [];
    }
  );

  // Persist user-created events to localStorage
  useEffect(() => {
    const userEvents = events.filter((e) => userCreatedEventIds.includes(e.id));
    localStorage.setItem("userCreatedEvents", JSON.stringify(userEvents));
    localStorage.setItem(
      "userCreatedEventIds",
      JSON.stringify(userCreatedEventIds)
    );
  }, [events, userCreatedEventIds]);

  // Add event handler
  const addEvent = useCallback(
    (eventData: {
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

      setEvents((prev) => [newEvent, ...prev]);
      setUserCreatedEventIds((prev) => [...prev, newId]);
      return newId;
    },
    []
  );

  // Update event handler
  const updateEvent = useCallback(
    (eventId: number, eventData: {
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
    }) => {
      setEvents((prev) =>
        prev.map((event) =>
          event.id === eventId
            ? {
                ...event,
                title: eventData.title,
                description: eventData.description,
                date: eventData.date,
                time: eventData.time,
                location: eventData.location,
                category: eventData.category,
                price: eventData.price,
                food: eventData.food,
                requiresRegistration: eventData.requiresRegistration,
                organization: eventData.organization,
                dayOfWeek: getDayOfWeek(eventData.date),
                eventDate: new Date(eventData.date),
              }
            : event
        )
      );
      // Update localStorage if it's a user-created event
      if (userCreatedEventIds.includes(eventId)) {
        const updatedEvents = events
          .filter((e) => userCreatedEventIds.includes(e.id))
          .map((e) => (e.id === eventId ? { ...e, ...eventData } : e));
        localStorage.setItem("userCreatedEvents", JSON.stringify(updatedEvents));
      }
    },
    [events, userCreatedEventIds]
  );

  // Delete event handler
  const deleteEvent = useCallback(
    (eventId: number) => {
      setEvents((prev) => prev.filter((event) => event.id !== eventId));
      // Remove from user-created events if applicable
      if (userCreatedEventIds.includes(eventId)) {
        setUserCreatedEventIds((prev) => prev.filter((id) => id !== eventId));
        const updatedEvents = events.filter((e) => e.id !== eventId && userCreatedEventIds.includes(e.id));
        localStorage.setItem("userCreatedEvents", JSON.stringify(updatedEvents));
        localStorage.setItem(
          "userCreatedEventIds",
          JSON.stringify(userCreatedEventIds.filter((id) => id !== eventId))
        );
      }
    },
    [events, userCreatedEventIds]
  );

  // Handle edit event
  const handleEditEvent = useCallback((event: Event) => {
    setEditingEvent(event);
    setShowSubmitEvent(true);
  }, []);

  // Convert Event to EventFormData for edit mode
  const eventToFormData = useCallback((event: Event) => {
    return {
      title: event.title,
      description: event.description || "",
      date: event.date,
      time: event.time,
      location: event.location,
      category: event.category,
      price: event.price,
      food: event.food,
      requiresRegistration: event.requiresRegistration,
      organization: event.organization,
    };
  }, []);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    "Events",
    "Clubs",
    "Academic",
  ]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([
    "LAX",
    "Pollock",
    "TCF 1",
  ]);
  const [selectedFoods, setSelectedFoods] = useState<string[]>([
    "Snacks",
    "Pizza",
  ]);
  const [selectedDays, setSelectedDays] = useState<string[]>([
    "Monday",
    "Wednesday",
    "Thursday",
  ]);
  const [priceRange, setPriceRange] = useState({ min: "", max: "" });
  const [dateRange, setDateRange] = useState<Date | undefined>(undefined);
  const [addedSince, setAddedSince] = useState<Date | undefined>(undefined);
  const [requiresRegistration, setRequiresRegistration] = useState(false);

  // Sort states
  const [sortBy, setSortBy] = useState<string>("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // School dropdown state
  const [selectedSchool, setSelectedSchool] = useState(
    "University of Waterloo"
  );

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
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  // Command palette state
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Profile/onboarding completion state
  const [profileCompleted, setProfileCompleted] = useState(false);
  
  // User email state (persisted to localStorage)
  const [userEmail, setUserEmail] = useState<string | null>(() => {
    const saved = localStorage.getItem("userEmail");
    return saved ? saved : null;
  });
  
  // Admin check - everyone is admin by default for now
  const isAdmin = true;
  
  // Persist email to localStorage
  useEffect(() => {
    if (userEmail) {
      localStorage.setItem("userEmail", userEmail);
    } else {
      localStorage.removeItem("userEmail");
    }
  }, [userEmail]);

  // Handle QR code scans from URL
  useEffect(() => {
    const path = window.location.pathname;
    const qrMatch = path.match(/^\/qr\/(.+)$/);
    if (qrMatch) {
      const qrCodeId = qrMatch[1];
      const qrCode = getQRCodeById(qrCodeId);
      if (qrCode) {
        handleQRRedirect(qrCode);
      } else {
        // QR code not found, redirect to events page
        navigate("/", { replace: true });
      }
    }
  }, []);

  // Handle URL parameters for eventId and filters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get("eventId");
    const filtersParam = params.get("filters");
    const pageModeParam = params.get("pageMode");

    if (pageModeParam) {
      if (pageModeParam === "marketing") {
        navigate("/marketing", { replace: true });
      } else if (pageModeParam === "events") {
        navigate("/", { replace: true });
      }
    }

    if (filtersParam) {
      try {
        const filters = JSON.parse(decodeURIComponent(filtersParam));
        if (filters.categories) setSelectedCategories(filters.categories);
        if (filters.locations) setSelectedLocations(filters.locations);
        if (filters.foods) setSelectedFoods(filters.foods);
        if (filters.days) setSelectedDays(filters.days);
        if (filters.priceRange) setPriceRange(filters.priceRange);
        if (filters.dateRange) setDateRange(new Date(filters.dateRange));
        if (filters.addedSince) setAddedSince(new Date(filters.addedSince));
        if (filters.requiresRegistration !== undefined)
          setRequiresRegistration(filters.requiresRegistration);
        if (filters.searchQuery) setSearchQuery(filters.searchQuery);
      } catch (e) {
        console.error("Failed to parse filters from URL", e);
      }
    }

    if (eventId) {
      // Scroll to event if found
      const event = events.find((e) => e.id === parseInt(eventId));
      if (event) {
        setTimeout(() => {
          const eventCard = document.querySelector(
            `[data-event-id="${eventId}"]`
          );
          eventCard?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    }
  }, [events]);

  // Dark mode state (persisted to localStorage)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode");
    if (saved !== null) {
      return JSON.parse(saved);
    }
    // Check system preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Apply dark mode class to document (initial load only)
  // The AnimatedThemeToggler handles theme changes with view transitions
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("darkMode", JSON.stringify(isDarkMode));
  }, []); // Only run on mount

  // Sync isDarkMode state when theme changes externally
  const handleThemeChange = useCallback((isDark: boolean) => {
    setIsDarkMode(isDark);
  }, []);

  // Saved and registered events state (persisted to localStorage)
  const [savedEventIds, setSavedEventIds] = useState<number[]>(() => {
    const saved = localStorage.getItem("savedEventIds");
    return saved ? JSON.parse(saved) : [];
  });
  // Persist saved to localStorage
  useEffect(() => {
    localStorage.setItem("savedEventIds", JSON.stringify(savedEventIds));
  }, [savedEventIds]);

  // Event save handler
  const toggleSaveEvent = useCallback((eventId: number) => {
    setSavedEventIds((prev) => {
      const wasSaved = prev.includes(eventId);
      const newIds = prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId];
      
      // Track conversion if user came from QR code
      if (!wasSaved) {
        const sessionId = sessionStorage.getItem("qrSessionId");
        if (sessionId) {
          // Find the most recent QR scan for this session
          import("@/utils/qrRedirect").then(({ getQRScans, addConversionAction }) => {
            const scans = getQRScans();
            const recentScan = scans
              .filter((s) => s.sessionId === sessionId)
              .sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime())[0];
            if (recentScan) {
              addConversionAction(recentScan.qrCodeId, "event_saved", sessionId);
            }
          });
        }
      }
      
      return newIds;
    });
  }, []);

  // Saved filter for quick filter
  const [savedFilter, setSavedFilter] = useState(false);

  // Credits and promotions state (persisted to localStorage)
  const [userCredits, setUserCredits] = useState<number>(() => {
    const saved = localStorage.getItem("userCredits");
    return saved ? JSON.parse(saved) : 100; // Start with 100 free credits
  });
  const [promotedEvents, setPromotedEvents] = useState<PromotedEvent[]>(() => {
    const saved = localStorage.getItem("promotedEvents");
    return saved ? JSON.parse(saved) : [];
  });
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  // Persist credits and promotions to localStorage
  useEffect(() => {
    localStorage.setItem("userCredits", JSON.stringify(userCredits));
  }, [userCredits]);

  useEffect(() => {
    localStorage.setItem("promotedEvents", JSON.stringify(promotedEvents));
  }, [promotedEvents]);

  // Add credits handler
  const addCredits = useCallback((amount: number) => {
    setUserCredits((prev) => prev + amount);
  }, []);

  // Promote event handler
  const promoteEvent = useCallback(
    (eventId: number, packageId: string, credits: number, duration: number) => {
      // Check if user has enough credits
      if (userCredits < credits) {
        setShowBuyCredits(true);
        return false;
      }

      // Deduct credits
      setUserCredits((prev) => prev - credits);

      // Add to promoted events
      const startDate = new Date().toISOString();
      const endDate = new Date(
        Date.now() + duration * 24 * 60 * 60 * 1000
      ).toISOString();

      setPromotedEvents((prev) => [
        ...prev.filter((p) => p.eventId !== eventId), // Remove existing promotion for this event
        {
          eventId,
          package: packageId as PromotedEvent["package"],
          startDate,
          endDate,
        },
      ]);

      return true;
    },
    [userCredits]
  );

  // Check if event is currently promoted
  const isEventPromoted = useCallback(
    (eventId: number) => {
      const now = new Date().toISOString();
      return promotedEvents.some(
        (p) => p.eventId === eventId && p.endDate > now
      );
    },
    [promotedEvents]
  );

  // Get active promoted event IDs
  const activePromotedEventIds = useMemo(() => {
    const now = new Date().toISOString();
    return promotedEvents.filter((p) => p.endDate > now).map((p) => p.eventId);
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
      setSelectedCategories(
        Array.isArray(parsed.categories) ? parsed.categories : []
      );
      setSelectedLocations(
        Array.isArray(parsed.locations) ? parsed.locations : []
      );
      setSelectedFoods(Array.isArray(parsed.foods) ? parsed.foods : []);
      setSelectedDays(Array.isArray(parsed.days) ? parsed.days : []);
      setPriceRange(parsed.priceRange || { min: "", max: "" });
      setDateRange(
        parsed.dateRange && parsed.dateRange.length > 0
          ? new Date(parsed.dateRange)
          : undefined
      );
      setAddedSince(
        parsed.addedSince && parsed.addedSince.length > 0
          ? new Date(parsed.addedSince)
          : undefined
      );
      setRequiresRegistration(parsed.requiresRegistration || false);
    } catch (e) {
      setJsonError("Invalid JSON format");
    }
  };

  // Section toggle - memoized with useCallback
  const toggleSection = useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    },
    []
  );

  // Filter toggle functions - memoized with useCallback
  const toggleCategory = useCallback(
    (cat: string) =>
      setSelectedCategories((prev) =>
        prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
      ),
    []
  );

  const toggleLocation = useCallback(
    (loc: string) =>
      setSelectedLocations((prev) =>
        prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
      ),
    []
  );

  const toggleDay = useCallback(
    (day: string) =>
      setSelectedDays((prev) =>
        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
      ),
    []
  );

  const toggleFood = useCallback(
    (food: string) =>
      setSelectedFoods((prev) =>
        prev.includes(food) ? prev.filter((f) => f !== food) : [...prev, food]
      ),
    []
  );

  // Clear all filters handler - memoized with useCallback
  const handleClearAllFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedCategories([]);
    setSelectedLocations([]);
    setSelectedFoods([]);
    setSelectedDays([]);
    setPriceRange({ min: "", max: "" });
    setDateRange(undefined);
    setAddedSince(undefined);
    setRequiresRegistration(false);
    setTodayFilter(false);
    setFreeFilter(false);
    setFreeFoodFilter(false);
    setForYouFilter(false);
    setSavedFilter(false);
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
      setJsonError(
        "OpenAI API key not configured. Add your key in src/lib/openai.ts"
      );
      return;
    }

    setAiGenerating(true);
    setJsonError("");

    try {
      const newFilters = await generateFiltersWithAI(
        aiPrompt,
        (partialJson) => {
          // Update the editor with partial JSON as it streams in
          setJsonValue(partialJson);
        }
      );
      // Apply the final parsed filters
      const generatedJson = JSON.stringify(newFilters, null, 2);
      setJsonValue(generatedJson);
      handleJsonChange(generatedJson);
    } catch (error) {
      console.error("AI generation error:", error);
      setJsonError(
        error instanceof Error
          ? error.message
          : "Failed to generate filters. Please try again."
      );
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
      if (
        searchQuery &&
        !event.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;

      // Saved filter - only show saved events
      if (savedFilter && !savedEventIds.includes(event.id)) return false;

      // Quick filters (these override the advanced filters when active)
      if (todayFilter && event.date !== "Today") return false;
      if (freeFilter && event.price !== 0) return false;
      if (freeFoodFilter && (event.food.length === 0 || event.price > 0))
        return false;
      if (
        forYouFilter &&
        profileCompleted &&
        selectedCategories.length > 0 &&
        !selectedCategories.includes(event.category)
      )
        return false;

      // Advanced filters (only apply when quick filters are not overriding)
      if (
        !todayFilter &&
        !thisWeekFilter &&
        selectedDays.length > 0 &&
        !selectedDays.includes(event.dayOfWeek)
      )
        return false;
      if (!freeFilter && !freeFoodFilter) {
        if (priceRange.min && event.price < parseFloat(priceRange.min))
          return false;
        if (priceRange.max && event.price > parseFloat(priceRange.max))
          return false;
      }
      if (
        selectedLocations.length > 0 &&
        !selectedLocations.some((loc) => event.location.includes(loc))
      )
        return false;
      if (
        includeFoods &&
        selectedFoods.length > 0 &&
        !event.food.some((f) => selectedFoods.includes(f))
      )
        return false;
      if (
        !forYouFilter &&
        selectedCategories.length > 0 &&
        !selectedCategories.includes(event.category)
      )
        return false;
      if (requiresRegistration && !event.requiresRegistration) return false;

      return true;
    });
  }, [
    events,
    searchQuery,
    todayFilter,
    freeFilter,
    freeFoodFilter,
    forYouFilter,
    thisWeekFilter,
    selectedDays,
    priceRange,
    selectedLocations,
    includeFoods,
    selectedFoods,
    selectedCategories,
    requiresRegistration,
    profileCompleted,
    savedFilter,
    savedEventIds,
  ]);

  // Calculate filter count - memoized with useMemo
  const filterCount = useMemo(
    () =>
      selectedCategories.length +
      selectedLocations.length +
      selectedFoods.length +
      selectedDays.length +
      (priceRange.min || priceRange.max ? 1 : 0) +
      (dateRange ? 1 : 0) +
      (requiresRegistration ? 1 : 0),
    [
      selectedCategories,
      selectedLocations,
      selectedFoods,
      selectedDays,
      priceRange,
      dateRange,
      requiresRegistration,
    ]
  );

  // Memoized pie menu items to prevent recreation on every render
  const categoryPieItems = useMemo(
    () =>
      availableCategories.map((cat) => ({
        id: cat,
        label: cat,
        icon: <Tag className="w-4 h-4" />,
      })),
    []
  );

  const locationPieItems = useMemo(
    () =>
      availableLocations.map((loc) => ({
        id: loc,
        label: loc,
        icon: <MapPin className="w-4 h-4" />,
      })),
    []
  );

  const foodPieItems = useMemo(
    () =>
      availableFoods.map((food) => ({
        id: food,
        label: food,
        icon: <Utensils className="w-4 h-4" />,
      })),
    []
  );

  const dayPieItems = useMemo(
    () =>
      availableDays.map((day) => ({
        id: day,
        label: day,
        icon: <Calendar className="w-4 h-4" />,
      })),
    []
  );

  const sortPieItems = useMemo(
    () => [
      { id: "date", label: "Date", icon: <CalendarDays className="w-4 h-4" /> },
      { id: "title", label: "Title", icon: <Tag className="w-4 h-4" /> },
      {
        id: "location",
        label: "Location",
        icon: <MapPin className="w-4 h-4" />,
      },
      {
        id: "price",
        label: "Price",
        icon: <ArrowUpDown className="w-4 h-4" />,
      },
    ],
    []
  );

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-dvh flex flex-col">
        {/* Easter Eggs */}
        <EasterEggs
          activeEasterEgg={activeEasterEgg}
          onComplete={clearEasterEgg}
        />

        {/* Onboarding Modal */}
        <OnboardingModal
          isOpen={showOnboarding}
          onClose={() => setShowOnboarding(false)}
          onComplete={(data) => {
            // Note: faculty is now selected during onboarding, school dropdown remains for university selection
            setProfileCompleted(true);
            if (data.email) {
              setUserEmail(data.email);
            }
          }}
        />

        {/* Getting Started Checklist - only show when signed in */}
        {profileCompleted && (
          <GettingStartedChecklist
            onOpenOnboarding={() => setShowOnboarding(true)}
            onNavigateToFilters={() => setShowFilterDropdown(true)}
            onViewEvent={() => {
              // Auto-scroll to first event card
              const firstCard = document.querySelector("[data-event-card]");
              firstCard?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }}
            profileCompleted={profileCompleted}
          />
        )}

        {/* Submit Event Modal */}
        <SubmitEventModal
          isOpen={showSubmitEvent}
          onClose={() => {
            setShowSubmitEvent(false);
            setEditingEvent(null);
          }}
          onSubmit={(eventData) => {
            // Add the event to the events list and return the ID
            const eventId = addEvent(eventData);
            return eventId;
          }}
          userCredits={userCredits}
          onPromote={promoteEvent}
          onBuyCredits={() => setShowBuyCredits(true)}
          editEventId={editingEvent?.id}
          initialData={editingEvent ? eventToFormData(editingEvent) : undefined}
          onUpdate={(eventId, eventData) => {
            updateEvent(eventId, eventData);
            setEditingEvent(null);
            setShowSubmitEvent(false);
          }}
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
                  const searchInput = document.querySelector(
                    'input[placeholder="Search events, clubs, activities..."]'
                  ) as HTMLInputElement;
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
                  navigate("/my-events");
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
                      navigate("/my-events");
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
                <span>
                  {profileCompleted ? "Edit Profile" : "Create Profile"}
                </span>
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
                  navigate("/about");
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
        <header className="flex items-center justify-between fixed top-0 left-0 right-0 h-12 pl-5 pr-5 border-b border-border bg-sidebar z-50">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => navigate("/")}
              className="h-6 w-6 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
              aria-label="Go to events"
            >
              <img
                alt="Logo"
                className="w-full h-full object-cover rounded"
                src={imgImage1}
              />
            </button>
            <span className="text-muted-foreground text-lg font-light">/</span>
            <SchoolCombobox
              value={selectedSchool}
              onChange={setSelectedSchool}
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Dark Mode Toggle */}
            <AnimatedThemeToggler />
            <Tooltip>
              <TooltipTrigger asChild></TooltipTrigger>
              <TooltipContent>
                <p>
                  {isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Admin Button - Always visible */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate("/admin")}
                  className="flex items-center gap-1.5 bg-muted hover:bg-gray-200 text-foreground font-medium text-sm px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                >
                  <Shield className="w-4 h-4" strokeWidth={2.5} />
                  Admin
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Admin Panel</p>
              </TooltipContent>
            </Tooltip>

            {/* Auth Button */}
            {profileCompleted ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      setProfileCompleted(false);
                      setUserEmail(null);
                    }}
                    className="flex items-center gap-1.5 bg-muted hover:bg-gray-200 text-foreground font-medium text-sm px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
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
                  <InteractiveHoverButton
                    onClick={() => setShowOnboarding(true)}
                    className="flex items-center gap-1.5 bg-primary border-primary text-white font-medium text-sm px-8 py-1.5 w-fit"
                    hideDot
                  >
                    Sign in
                  </InteractiveHoverButton>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sign in to save preferences</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </header>

        <div className="flex overflow-hidden flex-1">
          {/* Side Navigation */}
          <aside
            onMouseEnter={() => setSidebarHovered(true)}
            onMouseLeave={() => setSidebarHovered(false)}
            className="flex flex-col transition-all duration-200 overflow-hidden fixed left-0 top-12 bottom-0 border-r border-border bg-sidebar z-40"
            style={{
              width: sidebarHovered ? "180px" : "48px",
            }}
          >
            <div className="p-2">
              <nav className="flex flex-col gap-1">
                {/* Command Palette Trigger - Above Events */}
                <button
                  onClick={() => setShowCommandPalette(true)}
                  className="w-full font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 text-muted-foreground hover:bg-gray-200 hover:text-gray-800 mb-1"
                >
                  <Search
                    className="w-4 h-4 flex-shrink-0"
                    strokeWidth={2}
                  />
                  <span
                    className="flex-1 whitespace-nowrap transition-opacity duration-150"
                    style={{ opacity: sidebarHovered ? 1 : 0 }}
                  >
                    Search
                  </span>
                  {sidebarHovered && (
                    <div className="flex items-center gap-0.5">
                      <span className="flex items-center justify-center w-[18px] h-[18px] bg-muted border border-border rounded shadow-sm text-[9px] text-muted-foreground">
                        ⌘
                      </span>
                      <span className="flex items-center justify-center w-[18px] h-[18px] bg-muted border border-border rounded shadow-sm text-[9px] text-muted-foreground">
                        K
                      </span>
                    </div>
                  )}
                </button>

                {/* Events Section - Different for logged in/out */}
                {profileCompleted ? (
                  /* Logged In: Expandable Events with sublinks */
                  <div
                    className={`rounded ${
                      pageMode === "events" ? "bg-gray-100" : "bg-transparent"
                    }`}
                  >
                    <button
                      onClick={() => setEventsExpanded(!eventsExpanded)}
                      className={`w-full font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 ${
                        pageMode === "events"
                          ? "text-gray-900"
                          : "text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
                      }`}
                    >
                      <CalendarDays
                        className="w-4 h-4 flex-shrink-0"
                        strokeWidth={2}
                      />
                      <span
                        className="flex-1 whitespace-nowrap transition-opacity duration-150"
                        style={{ opacity: sidebarHovered ? 1 : 0 }}
                      >
                        Events
                      </span>
                      {sidebarHovered && (
                        <ChevronDown
                          className="w-3 h-3 flex-shrink-0 transition-transform duration-200"
                          style={{
                            transform: eventsExpanded
                              ? "rotate(0deg)"
                              : "rotate(-90deg)",
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
                        opacity: eventsExpanded ? 1 : 0,
                      }}
                    >
                      <div
                        className="flex flex-col gap-0.5 mt-0.5"
                        style={{ paddingLeft: sidebarHovered ? "20px" : "0px" }}
                      >
                        <button
                          onClick={() => navigate("/")}
                          className={`font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 ${
                            pageMode === "events"
                              ? "bg-gray-100 text-gray-900"
                              : "text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
                          }`}
                        >
                          <Compass
                            className="w-4 h-4 flex-shrink-0"
                            strokeWidth={2}
                          />
                          <span
                            className="whitespace-nowrap transition-opacity duration-150"
                            style={{ opacity: sidebarHovered ? 1 : 0 }}
                          >
                            Explore
                          </span>
                        </button>
                        <button
                          onClick={() => setShowSubmitEvent(true)}
                          className="font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
                        >
                          <Plus
                            className="w-4 h-4 flex-shrink-0"
                            strokeWidth={2}
                          />
                          <span
                            className="whitespace-nowrap transition-opacity duration-150"
                            style={{ opacity: sidebarHovered ? 1 : 0 }}
                          >
                            Create
                          </span>
                        </button>
                        <button
                          onClick={() => navigate("/my-events")}
                          className={`font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 ${
                            pageMode === "myEvents"
                              ? "bg-gray-100 text-gray-900"
                              : "text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
                          }`}
                        >
                          <Megaphone
                            className="w-4 h-4 flex-shrink-0"
                            strokeWidth={2}
                          />
                          <span
                            className="whitespace-nowrap transition-opacity duration-150"
                            style={{ opacity: sidebarHovered ? 1 : 0 }}
                          >
                            My Events
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Logged Out: Simple Events link */
                  <button
                    onClick={() => navigate("/")}
                    className={`w-full font-medium text-[11px] rounded text-left flex items-center px-2 py-1.5 gap-2 ${
                      pageMode === "events"
                        ? "bg-gray-100 text-gray-900"
                        : "text-muted-foreground hover:bg-gray-100 hover:text-gray-800"
                    }`}
                  >
                    <CalendarDays
                      className="w-4 h-4 flex-shrink-0"
                      strokeWidth={2}
                    />
                    <span
                      className="flex-1 whitespace-nowrap transition-opacity duration-150"
                      style={{ opacity: sidebarHovered ? 1 : 0 }}
                    >
                      Events
                    </span>
                  </button>
                )}

                <NavButton
                  icon={Shield}
                  label="Clubs"
                  isActive={pageMode === "clubs"}
                  onClick={() => navigate("/clubs")}
                  expanded={sidebarHovered}
                />
                <NavButton
                  icon={Target}
                  label="Mission"
                  isActive={pageMode === "about"}
                  onClick={() => navigate("/about")}
                  expanded={sidebarHovered}
                />
                <NavButton
                  icon={Mail}
                  label="Contact"
                  expanded={sidebarHovered}
                />
              </nav>
            </div>

            {/* Settings Section - Only show when logged in */}
            {profileCompleted && (
              <div className="mt-auto p-2 border-t border-border">
                <button className="w-full font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 text-muted-foreground hover:bg-gray-200 hover:text-gray-800">
                  <Settings
                    className="w-4 h-4 flex-shrink-0"
                    strokeWidth={2}
                  />
                  <span
                    className="whitespace-nowrap transition-opacity duration-150"
                    style={{ opacity: sidebarHovered ? 1 : 0 }}
                  >
                    Settings
                  </span>
                </button>
              </div>
            )}
          </aside>

          {/* Main Content */}
          <div
            className="flex-1 overflow-auto ml-12 mt-12 p-6 main-content-grid"
            style={{
              minHeight: "calc(100vh - 48px)",
            }}
          >
            <Suspense
              fallback={
                <div className="flex items-center justify-center min-h-[400px]">
                  <div className="text-center space-y-4">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-primary border-t-transparent"></div>
                    <p className="text-sm text-muted-foreground">Loading page...</p>
                  </div>
                </div>
              }
            >
              <Routes>
                <Route path="/about" element={<AboutPage />} />
                <Route
                  path="/my-events"
                  element={
                    <MyEventsView
                      profileCompleted={profileCompleted}
                      onSignIn={() => setShowOnboarding(true)}
                      events={events}
                      savedEventIds={savedEventIds}
                      onToggleSave={toggleSaveEvent}
                    />
                  }
                />
                <Route path="/clubs" element={<ClubsPage />} />
                <Route
                  path="/admin"
                  element={
                    <AdminPanel
                      events={events}
                      onNavigate={(page) => {
                        if (page === "admin-events") navigate("/admin/events");
                        else if (page === "admin-clubs") navigate("/admin/clubs");
                        else if (page === "admin-submissions") navigate("/admin/submissions");
                        else if (page === "admin-posters") navigate("/admin/posters");
                        else navigate("/admin");
                      }}
                    />
                  }
                />
                <Route
                  path="/admin/events"
                  element={
                    <AdminEventsPage
                      events={events}
                      onEditEvent={handleEditEvent}
                      onDeleteEvent={deleteEvent}
                      onBack={() => navigate("/admin")}
                      onCreateEvent={() => setShowSubmitEvent(true)}
                    />
                  }
                />
                <Route
                  path="/admin/clubs"
                  element={
                    <AdminClubsPage
                      onBack={() => navigate("/admin")}
                      onAddClub={(club) => {
                        // TODO: Implement add club functionality
                      }}
                      onEditClub={(club) => {
                        // TODO: Implement edit club functionality
                      }}
                      onDeleteClub={(clubId) => {
                        // TODO: Implement delete club functionality
                      }}
                    />
                  }
                />
                <Route
                  path="/admin/submissions"
                  element={
                    <AdminSubmissionsPage
                      onBack={() => navigate("/admin")}
                      onApprove={(submission) => {
                        // Convert submission to event and add it
                        const eventData = submission.eventData;
                        const newId = Date.now();
                        const newEvent: Event = {
                          id: newId,
                          title: eventData.title,
                          category: eventData.category || "Events",
                          organization: eventData.organization,
                          location: eventData.location,
                          date: eventData.date,
                          time: eventData.time,
                          isLive: true,
                          food: eventData.food,
                          price: eventData.price,
                          dayOfWeek: getDayOfWeek(eventData.date),
                          requiresRegistration: eventData.requiresRegistration,
                          addedDate: new Date(),
                          description: eventData.description,
                        };
                        setEvents((prev) => [...prev, newEvent]);
                        setUserCreatedEventIds((prev) => [...prev, newId]);
                      }}
                    />
                  }
                />
                <Route
                  path="/admin/posters"
                  element={
                    <AdminPostersPage
                      onBack={() => navigate("/admin")}
                      events={events}
                      userEmail={userEmail || ""}
                    />
                  }
                />
                <Route
                  path="/marketing"
                  element={<MarketingPage events={events} userEmail={userEmail || ""} />}
                />
              <Route
                path="/"
                element={
              <div className="space-y-5">
                {/* Search and Quick Filters - Always Visible */}
                <div className="space-y-5">
                  {/* Search Bar with View Mode Tabs */}
                  <div className="flex gap-3 items-stretch">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search events, clubs, activities..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          checkSearchQuery(e.target.value);
                        }}
                        className="w-full border border-border bg-muted text-foreground rounded-xl pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all shadow-md"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* View Mode Toggle - Moved here */}
                    <div className="bg-muted flex items-stretch p-0.5 rounded-xl gap-0.5">
                      <ViewModeButton
                        icon={Grid3x3}
                        label="Grid"
                        isActive={viewMode === "grid"}
                        onClick={() => setViewMode("grid")}
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
                    <span className="font-bold text-xl text-foreground">
                      {filteredEvents.length}{" "}
                      {filteredEvents.length === 1 ? "event" : "events"}
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
                      {profileCompleted && (
                        <>
                          <QuickFilterChip
                            icon={<Sparkles className="w-3.5 h-3.5" />}
                            label="For You"
                            active={forYouFilter}
                            onClick={() => setForYouFilter(!forYouFilter)}
                          />
                          <QuickFilterChip
                            icon={<Heart className="w-3.5 h-3.5" />}
                            label="Saved"
                            active={savedFilter}
                            onClick={() => setSavedFilter(!savedFilter)}
                            badge={
                              savedEventIds.length > 0
                                ? savedEventIds.length
                                : undefined
                            }
                          />
                        </>
                      )}

                      {/* More Filters Button with Dropdown */}
                      <div className="relative">
                        <button
                          data-filter-trigger
                          onClick={() =>
                            setShowFilterDropdown(!showFilterDropdown)
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                            showFilterDropdown || filterCount > 0
                              ? "bg-primary/20 dark:bg-primary/40 text-primary"
                              : "bg-muted text-muted-foreground hover:bg-gray-200"
                          }`}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          More Filters
                          {filterCount > 0 && (
                            <span
                              className="bg-primary text-white px-1.5 py-0.5 rounded-full text-[10px] ml-1 flex items-center gap-1 hover:bg-primary/90 transition-colors"
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
                            className="rounded-xl overflow-y-auto absolute right-0 top-full mt-2 z-50 px-4 py-4 max-h-[calc(100vh-200px)] bg-card border border-border"
                            style={{ width: "300px" }}
                          >
                            {/* Header */}
                            <div className="flex items-center justify-between mb-3">
                              <h2 className="font-bold text-base text-foreground">
                                Filters
                              </h2>
                              <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                                <button
                                  onClick={() => setFilterViewMode("visual")}
                                  className={`${
                                    filterViewMode === "visual"
                                      ? "bg-card text-foreground shadow-sm"
                                      : "bg-transparent text-muted-foreground hover:text-foreground"
                                  } font-medium text-[11px] px-3 py-1 rounded transition-all`}
                                >
                                  Visual
                                </button>
                                <button
                                  onClick={() => setFilterViewMode("json")}
                                  className={`${
                                    filterViewMode === "json"
                                      ? "bg-card text-foreground shadow-sm"
                                      : "bg-transparent text-muted-foreground hover:text-foreground"
                                  } font-medium text-[11px] px-3 py-1 rounded transition-all`}
                                >
                                  JSON
                                </button>
                              </div>
                            </div>

                            {/* AI Generation Input - Always Visible */}
                            <div className="mb-4 space-y-2">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5 text-primary" />
                                <span className="text-xs font-medium text-foreground">
                                  AI Filter Generation
                                </span>
                              </div>
                              <div className="relative">
                                <input
                                  type="text"
                                  placeholder={
                                    aiGenerating
                                      ? "Generating..."
                                      : "Describe filters (e.g. 'free food events this week')..."
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
                                  className="w-full bg-muted text-foreground text-xs px-3 py-2 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 border border-border placeholder:text-muted-foreground disabled:opacity-60"
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
                                    <div className="w-3 h-3 border-2 border-gray-300 dark:border-gray-600 border-t-primary rounded-full animate-spin" />
                                  </div>
                                )}
                              </div>
                              {jsonError && (
                                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-[11px]">
                                  {jsonError}
                                </div>
                              )}
                            </div>

                            {filterViewMode === "visual" ? (
                              <>
                                <div className="-space-y-px">
                                  {/* Category */}
                                  <FilterSection
                                    title="Category"
                                    expanded={expandedSections.category}
                                    onToggle={() => toggleSection("category")}
                                    indicator={
                                      selectedCategories.length > 0
                                        ? `${selectedCategories.length}`
                                        : undefined
                                    }
                                    onClear={() => setSelectedCategories([])}
                                  >
                                    <div className="relative">
                                      <button
                                        onClick={categoryPieMenu.open}
                                        className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                      >
                                        <span>
                                          {selectedCategories.length > 0
                                            ? selectedCategories.join(", ")
                                            : "Select Categories"}
                                        </span>
                                        <Tag className="w-4 h-4 text-muted-foreground" />
                                      </button>
                                      <PieMenu
                                        items={categoryPieItems}
                                        isOpen={categoryPieMenu.isOpen}
                                        position={categoryPieMenu.position}
                                        onClose={categoryPieMenu.close}
                                        onSelect={(item) =>
                                          toggleCategory(item.id)
                                        }
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
                                        onClick={() =>
                                          setShowDateRangePicker(
                                            !showDateRangePicker
                                          )
                                        }
                                        className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between"
                                      >
                                        <span>
                                          {dateRange
                                            ? dateRange.toLocaleDateString(
                                                "en-US",
                                                {
                                                  month: "short",
                                                  day: "numeric",
                                                  year: "numeric",
                                                }
                                              )
                                            : "Select Date"}
                                        </span>
                                        <CalendarDays className="w-4 h-4 text-muted-foreground" />
                                      </button>
                                      {showDateRangePicker && (
                                        <div className="absolute z-50 mt-2">
                                          <DatePicker
                                            selected={dateRange}
                                            onSelect={(date) =>
                                              setDateRange(date)
                                            }
                                            onClose={() =>
                                              setShowDateRangePicker(false)
                                            }
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
                                    indicator={
                                      selectedLocations.length > 0
                                        ? `${selectedLocations.length}`
                                        : undefined
                                    }
                                    onClear={() => setSelectedLocations([])}
                                  >
                                    <div className="relative">
                                      <button
                                        onClick={locationPieMenu.open}
                                        className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                      >
                                        <span>
                                          {selectedLocations.length > 0
                                            ? selectedLocations.join(", ")
                                            : "Select Locations"}
                                        </span>
                                        <MapPin className="w-4 h-4 text-muted-foreground" />
                                      </button>
                                      <PieMenu
                                        items={locationPieItems}
                                        isOpen={locationPieMenu.isOpen}
                                        position={locationPieMenu.position}
                                        onClose={locationPieMenu.close}
                                        onSelect={(item) =>
                                          toggleLocation(item.id)
                                        }
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
                                    indicator={
                                      priceRange.min || priceRange.max
                                        ? "1"
                                        : undefined
                                    }
                                    onClear={() =>
                                      setPriceRange({ min: "", max: "" })
                                    }
                                  >
                                    <div className="flex gap-2 items-center w-full">
                                      <input
                                        type="number"
                                        placeholder="Min"
                                        value={priceRange.min}
                                        onChange={(e) =>
                                          setPriceRange((prev) => ({
                                            ...prev,
                                            min: e.target.value,
                                          }))
                                        }
                                        className="w-0 flex-1 min-w-0 border border-border bg-card text-foreground rounded-xl px-2.5 py-2.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all"
                                      />
                                      <span className="text-muted-foreground text-[11px] flex-shrink-0">
                                        to
                                      </span>
                                      <input
                                        type="number"
                                        placeholder="Max"
                                        value={priceRange.max}
                                        onChange={(e) =>
                                          setPriceRange((prev) => ({
                                            ...prev,
                                            max: e.target.value,
                                          }))
                                        }
                                        className="w-0 flex-1 min-w-0 border border-border bg-card text-foreground rounded-xl px-2.5 py-2.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all"
                                      />
                                    </div>
                                  </FilterSection>

                                  {/* Food */}
                                  <FilterSection
                                    title="Food"
                                    expanded={expandedSections.food}
                                    onToggle={() => toggleSection("food")}
                                    indicator={
                                      selectedFoods.length > 0
                                        ? `${selectedFoods.length}`
                                        : undefined
                                    }
                                    onClear={() => setSelectedFoods([])}
                                  >
                                    <div className="relative">
                                      <button
                                        onClick={foodPieMenu.open}
                                        className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                      >
                                        <span>
                                          {selectedFoods.length > 0
                                            ? selectedFoods.join(", ")
                                            : "Select Food Options"}
                                        </span>
                                        <Utensils className="w-4 h-4 text-muted-foreground" />
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
                                    indicator={
                                      selectedDays.length > 0
                                        ? `${selectedDays.length}`
                                        : undefined
                                    }
                                    onClear={() => setSelectedDays([])}
                                  >
                                    <div className="relative">
                                      <button
                                        onClick={dayPieMenu.open}
                                        className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                      >
                                        <span>
                                          {selectedDays.length > 0
                                            ? selectedDays.join(", ")
                                            : "Select Days"}
                                        </span>
                                        <Calendar className="w-4 h-4 text-muted-foreground" />
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
                                        onClick={() =>
                                          setShowAddedSincePicker(
                                            !showAddedSincePicker
                                          )
                                        }
                                        className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between"
                                      >
                                        <span>
                                          {addedSince
                                            ? addedSince.toLocaleDateString(
                                                "en-US",
                                                {
                                                  month: "short",
                                                  day: "numeric",
                                                  year: "numeric",
                                                }
                                              )
                                            : "Select Date"}
                                        </span>
                                        <CalendarDays className="w-4 h-4 text-muted-foreground" />
                                      </button>
                                      {showAddedSincePicker && (
                                        <div className="absolute z-50 mt-2">
                                          <DatePicker
                                            selected={addedSince}
                                            onSelect={(date) =>
                                              setAddedSince(date)
                                            }
                                            onClose={() =>
                                              setShowAddedSincePicker(false)
                                            }
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </FilterSection>

                                  {/* Registration Required */}
                                  <FilterSection
                                    title="Registration required"
                                    expanded={expandedSections.registration}
                                    onToggle={() =>
                                      toggleSection("registration")
                                    }
                                    indicator={
                                      requiresRegistration ? "1" : undefined
                                    }
                                    onClear={() =>
                                      setRequiresRegistration(false)
                                    }
                                  >
                                    <Checkbox
                                      checked={requiresRegistration}
                                      onChange={() =>
                                        setRequiresRegistration(
                                          !requiresRegistration
                                        )
                                      }
                                    />
                                  </FilterSection>

                                  <FilterSection
                                    title="Sort"
                                    expanded={expandedSections.sort}
                                    onToggle={() => toggleSection("sort")}
                                    indicator={
                                      sortBy
                                        ? `${
                                            sortBy.charAt(0).toUpperCase() +
                                            sortBy.slice(1)
                                          } ${sortOrder === "asc" ? "↑" : "↓"}`
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
                                          className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
                                        >
                                          <span>
                                            {sortBy
                                              ? sortBy.charAt(0).toUpperCase() +
                                                sortBy.slice(1)
                                              : "Select Sort Field"}
                                          </span>
                                          <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                                        </button>
                                        <PieMenu
                                          items={sortPieItems}
                                          isOpen={sortPieMenu.isOpen}
                                          position={sortPieMenu.position}
                                          onClose={sortPieMenu.close}
                                          onSelect={(item) =>
                                            setSortBy(item.id)
                                          }
                                          selectedIds={sortBy ? [sortBy] : []}
                                          closeOnSelect={true}
                                          radius={140}
                                          innerRadius={20}
                                        />
                                      </div>

                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => setSortOrder("asc")}
                                          className={`flex-1 px-2 py-1.5 rounded-xl text-[11px] font-medium transition-all ${
                                            sortOrder === "asc"
                                              ? "bg-primary text-white"
                                              : "bg-muted text-muted-foreground hover:bg-gray-200"
                                          }`}
                                        >
                                          Ascending
                                        </button>
                                        <button
                                          onClick={() => setSortOrder("desc")}
                                          className={`flex-1 px-2 py-1.5 rounded-xl text-[11px] font-medium transition-all ${
                                            sortOrder === "desc"
                                              ? "bg-primary text-white"
                                              : "bg-muted text-muted-foreground hover:bg-gray-200"
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
                              <div className="space-y-2">
                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                  Edit JSON directly. Changes apply
                                  automatically.
                                </p>
                                <div className="border border-border rounded-lg overflow-hidden">
                                  <Suspense
                                    fallback={
                                      <div className="flex items-center justify-center h-[250px] bg-muted">
                                        <div className="text-muted-foreground text-sm">
                                          Loading editor...
                                        </div>
                                      </div>
                                    }
                                  >
                                    <Editor
                                      height="250px"
                                      defaultLanguage="json"
                                      value={jsonValue}
                                      onChange={handleJsonChange}
                                      theme={
                                        isDarkMode ? "vs-dark" : "vs-light"
                                      }
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
                <main className="w-full" role="main" aria-label="Events list">
                  <EventList
                    events={filteredEvents}
                    savedEventIds={savedEventIds}
                    activePromotedEventIds={activePromotedEventIds}
                    onToggleSave={toggleSaveEvent}
                    viewMode={viewMode}
                    allEvents={events}
                    isAdmin={isAdmin}
                    onEdit={handleEditEvent}
                    onDelete={deleteEvent}
                    onClearFilters={handleClearAllFilters}
                  />
                </main>
              </div>
                }
              />
              </Routes>
            </Suspense>
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
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number | string;
  }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  expanded: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 w-full cursor-pointer ${
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
      <span
        className="whitespace-nowrap transition-opacity duration-150"
        style={{ opacity: expanded ? 1 : 0 }}
      >
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
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number | string;
  }>;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`${
        isActive ? "bg-card shadow-sm" : "bg-transparent hover:bg-muted"
      } font-medium text-[11px] text-foreground px-2.5 py-1 rounded transition-all flex items-center gap-1 cursor-pointer h-full`}
    >
      <Icon className="w-3 h-3" strokeWidth={2} />
      <span className="leading-none">{label}</span>
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={`w-5 h-5 border-2 ${
        checked
          ? "border-primary bg-primary"
          : "border-gray-300 dark:border-gray-600 bg-card"
      } rounded transition-all flex items-center justify-center hover:border-primary cursor-pointer`}
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
        disabled
          ? "bg-muted text-muted-foreground"
          : active
          ? "bg-primary/20 dark:bg-primary/40 text-primary"
          : highlight
          ? "bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:opacity-90"
          : "bg-muted text-muted-foreground hover:bg-muted/80 dark:hover:bg-muted/60"
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            active
              ? "bg-primary/30 dark:bg-primary/50 text-primary"
              : "bg-gray-200 dark:bg-gray-700 text-muted-foreground"
          }`}
        >
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
