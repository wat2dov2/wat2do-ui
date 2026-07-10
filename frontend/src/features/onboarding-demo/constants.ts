import type { PreviewEventData } from "@/features/auth/components/PreviewStyleEventCard";
import type { OnboardingDemoStep } from "./types";

export const ONBOARDING_DEMO_STEPS: OnboardingDemoStep[] = [
  "welcome",
  "campus_intent",
  "availability",
  "event_match",
  "radar_payoff",
  "build_week",
  "pro_unlock",
  "pro_challenge",
  "home",
];

export const PROGRESS_SEGMENTS = [
  { id: "start", label: "Start", steps: ["welcome"] as OnboardingDemoStep[] },
  {
    id: "personalize",
    label: "Personalize",
    steps: ["campus_intent", "availability"] as OnboardingDemoStep[],
  },
  {
    id: "discover",
    label: "Discover",
    steps: ["event_match", "radar_payoff", "build_week"] as OnboardingDemoStep[],
  },
  {
    id: "unlock",
    label: "Unlock",
    steps: ["pro_unlock", "pro_challenge", "home"] as OnboardingDemoStep[],
  },
] as const;

export const SOURCE_OPTIONS = [
  "Instagram",
  "Friend",
  "Club exec",
  "Orientation",
  "Reddit",
  "Discord",
  "Search",
  "Poster",
  "Other",
] as const;

export const INTEREST_OPTIONS = [
  "Free food",
  "Meet people",
  "Career events",
  "Tech",
  "Arts",
  "Culture",
  "Sports",
  "Study sessions",
  "Volunteering",
  "Parties",
  "Chill socials",
  "Something random",
] as const;

export const AVAILABILITY_OPTIONS = [
  "Tonight",
  "Weekdays after class",
  "Weekends",
  "Lunch breaks",
  "Evenings",
  "I am flexible",
] as const;

export const SOCIAL_OPTIONS = [
  { value: "solo" as const, label: "Solo" },
  { value: "friends" as const, label: "With friends" },
  { value: "meet_people" as const, label: "Looking to meet people" },
];

/** Hardcoded demo events - labeled as preview content in the UI. */
export const DEMO_EVENTS: (PreviewEventData & { id: number })[] = [
  {
    id: 1,
    title: "Free Pizza & Board Games Night",
    org: "WUSA",
    category: "Social",
    image: "",
    date: "Thu, Jun 19",
    time: "6:00 PM",
    location: "SLC Great Hall",
    badges: [{ text: "Free food", bgClass: "bg-primary/10", textClass: "text-primary" }],
  },
  {
    id: 2,
    title: "Startup Pitch Night",
    org: "Velocity",
    category: "Entrepreneurship",
    image: "",
    date: "Fri, Jun 20",
    time: "7:30 PM",
    location: "DC Library",
    badges: [],
  },
  {
    id: 3,
    title: "Intro to React Workshop",
    org: "WAT.ai",
    category: "Technology",
    image: "",
    date: "Wed, Jun 18",
    time: "5:00 PM",
    location: "MC 4026",
    badges: [{ text: "Workshop", bgClass: "bg-primary/10", textClass: "text-primary" }],
  },
  {
    id: 4,
    title: "Waterloo Jazz Ensemble",
    org: "FASS",
    category: "Music",
    image: "",
    date: "Sat, Jun 21",
    time: "8:00 PM",
    location: "Theatre of the Arts",
    badges: [],
  },
  {
    id: 5,
    title: "Career Fair Prep Clinic",
    org: "Co-op Office",
    category: "Career",
    image: "",
    date: "Mon, Jun 23",
    time: "12:00 PM",
    location: "TC 2218",
    badges: [],
  },
  {
    id: 6,
    title: "Intramural Volleyball Sign-up",
    org: "Athletics",
    category: "Sports",
    image: "",
    date: "Tue, Jun 24",
    time: "4:00 PM",
    location: "PAC Gym",
    badges: [],
  },
];

export const INTEREST_CATEGORY_MAP: Record<string, string[]> = {
  "Free food": ["Social"],
  "Meet people": ["Social", "Clubs"],
  "Career events": ["Career"],
  Tech: ["Technology"],
  Arts: ["Arts", "Music"],
  Culture: ["Cultural"],
  Sports: ["Sports"],
  "Study sessions": ["Academic"],
  Volunteering: ["Social"],
  Parties: ["Social"],
  "Chill socials": ["Social"],
  "Something random": ["Events"],
};
