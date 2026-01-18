export interface Event {
  id: number;
  title: string;
  category: string;
  organization: string;
  location: string;
  date: string;
  time: string;
  isLive: boolean;
  food: string[];
  price: number;
  dayOfWeek: string;
  requiresRegistration: boolean;
  addedDate: Date;
  description?: string;
  // For timeline sorting - actual date object
  eventDate?: Date;
  imageUrl?: string;
}

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  priceRange: { min: string; max: string };
  dateRange: string;
  addedSince: string;
  requiresRegistration: boolean;
}

// User's relationship with events
export interface UserEventState {
  savedEventIds: number[];
  registeredEventIds: number[];
}

export type ViewMode = "grid" | "calendar" | "map";
export type FilterViewMode = "visual" | "json";
export type PageMode = "events" | "about" | "myEvents";
export type MyEventsTab = "upcoming" | "past";

// Promotion types
export interface PromotedEvent {
  eventId: number;
  package: PromotionPackage;
  startDate: string;
  endDate: string;
}

export type PromotionPackage = "featured" | "email" | "combo";

export interface PromotionPackageInfo {
  id: PromotionPackage;
  name: string;
  description: string;
  credits: number;
  duration: number; // days
  originalCredits?: number; // for showing discount
}

export const PROMOTION_PACKAGES: PromotionPackageInfo[] = [
  {
    id: "featured",
    name: "Featured Placement",
    description: "Appear at the top of search results",
    credits: 50,
    duration: 7,
  },
  {
    id: "email",
    name: "Email Blast",
    description: "Reach 1000+ interested students",
    credits: 100,
    duration: 1,
  },
  {
    id: "combo",
    name: "Combo Pack",
    description: "Featured + Email + Social Post",
    credits: 200,
    duration: 7,
    originalCredits: 250,
  },
];

export const CREDIT_PACKAGES = [
  { credits: 100, price: 5, popular: false },
  { credits: 250, price: 10, popular: true, bonus: 50 },
  { credits: 500, price: 18, popular: false, bonus: 100 },
];
