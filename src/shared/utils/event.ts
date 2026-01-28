import type { Event, EventFormData } from "@/shared/types";

/**
 * Event Utilities
 * Handles event data transformations
 */

/**
 * Convert Event to EventFormData for edit mode
 */
export function eventToFormData(event: Event): EventFormData {
  return {
    title: event.title,
    description: event.description || "",
    date: event.date || "",
    time: event.time || "",
    location: event.location,
    category: event.category || "",
    price: event.price || 0,
    food: event.food || [],
    requiresRegistration: event.requiresRegistration || false,
    organization: event.organization || "",
  };
}

/**
 * Convert EventFormData to Event (for creating new events)
 * Note: This is a helper - actual creation should use eventService.createEvent
 */
export function formDataToEvent(
  formData: EventFormData,
  getDayOfWeek: (date: string) => string
): Omit<Event, "id" | "addedDate" | "eventDate"> {
  return {
    title: formData.title,
    category: formData.category || "Events",
    organization: formData.organization,
    location: formData.location,
    date: formData.date,
    time: formData.time,
    isLive: false,
    food: formData.food || [],
    price: formData.price || 0,
    dayOfWeek: getDayOfWeek(formData.date),
    requiresRegistration: formData.requiresRegistration || false,
    description: formData.description || "",
  };
}

/**
 * Check if event is upcoming
 */
export function isEventUpcoming(event: Event): boolean {
  if (!event.eventDate) return false;
  const now = new Date();
  return event.eventDate > now;
}

/**
 * Check if event is past
 */
export function isEventPast(event: Event): boolean {
  if (!event.eventDate) return false;
  const now = new Date();
  return event.eventDate < now;
}

/**
 * Get event status (upcoming, past, live)
 */
export function getEventStatus(event: Event): "upcoming" | "past" | "live" {
  if (event.isLive) return "live";
  if (isEventPast(event)) return "past";
  return "upcoming";
}

/**
 * Parse event date and time strings into a Date object
 * Handles multiple event date formats:
 * - eventDate (Date object) - preferred
 * - dtstart_utc (ISO 8601 UTC string) - new format
 * - date + time (strings) - old format
 */
export function parseEventDate(dateStr?: string, timeStr?: string): Date {
  // If we have a date string, try to parse it
  if (dateStr) {
    // Check if it's in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      
      // If we have a time string, parse and add it
      if (timeStr) {
        const timeMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const ampm = timeMatch[3].toUpperCase();
          
          if (ampm === 'PM' && hours !== 12) {
            hours += 12;
          } else if (ampm === 'AM' && hours === 12) {
            hours = 0;
          }
          
          date.setHours(hours, minutes, 0, 0);
        }
      }
      
      return date;
    }
    
    // Try parsing as ISO date string
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  
  // Fallback to current date if parsing fails
  return new Date();
}

/**
 * Deduplicate events by ID to prevent duplicate key warnings in React
 * Returns only the first occurrence of each event ID
 */
export function getUniqueEvents(events: Event[]): Event[] {
  const seen = new Set<number>();
  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }
    seen.add(event.id);
    return true;
  });
}

/**
 * Translate category names to localized strings
 * Maps category names to translation keys
 */
export function translateCategory(category: string, t: (key: string) => string): string {
  if (!category) return t("navigation.events");
  
  // Map category names to translation keys
  const categoryMap: Record<string, string> = {
    "Events": "categories.events",
    "Clubs": "categories.clubs",
    "Academic": "categories.academic",
    "Religious": "categories.religious",
    "Cultural": "categories.cultural",
    "Social & Games": "categories.socialGames",
    "Sports": "categories.sportsFitness",
    "Sports & Fitness": "categories.sportsFitness",
    "Athletics": "categories.sportsFitness",
    "Career": "categories.career",
    "Career & Networking": "categories.career",
    "Technology": "categories.technology",
    "Creative Arts": "categories.artsCrafts",
    "Arts & Crafts": "categories.artsCrafts",
    "Health & Wellness": "categories.healthWellness",
    "Music & Performance": "categories.musicPerformance",
    "Entrepreneurship": "categories.entrepreneurship",
  };
  
  const translationKey = categoryMap[category];
  if (translationKey) {
    return t(translationKey);
  }
  
  // Fallback: try to find a matching translation key by converting the category name
  const normalizedCategory = category.toLowerCase().replace(/[&\s]+/g, '');
  for (const [key, value] of Object.entries(categoryMap)) {
    const normalizedKey = key.toLowerCase().replace(/[&\s]+/g, '');
    if (normalizedCategory.includes(normalizedKey) || normalizedKey.includes(normalizedCategory)) {
      return t(value);
    }
  }
  
  // Final fallback
  return category;
}

/**
 * Get category color classes for styling
 * Returns Tailwind classes using design tokens
 */
export function getCategoryClasses(category: string): { bg: string; text: string } {
  const mapping: Record<string, { bg: string; text: string }> = {
    Events: { bg: "bg-category-events-bg", text: "text-category-events-text" },
    Clubs: { bg: "bg-category-clubs-bg", text: "text-category-clubs-text" },
    Academic: {
      bg: "bg-category-academic-bg",
      text: "text-category-academic-text",
    },
    "Career & Networking": {
      bg: "bg-category-career-bg",
      text: "text-category-career-text",
    },
    Career: { bg: "bg-category-career-bg", text: "text-category-career-text" },
    "Social & Games": {
      bg: "bg-category-social-bg",
      text: "text-category-social-text",
    },
    Athletics: { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    Sports: { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    "Sports & Fitness": { bg: "bg-category-sports-bg", text: "text-category-sports-text" },
    "Creative Arts": {
      bg: "bg-category-arts-bg",
      text: "text-category-arts-text",
    },
    "Arts & Crafts": {
      bg: "bg-category-arts-bg",
      text: "text-category-arts-text",
    },
    Cultural: {
      bg: "bg-category-cultural-bg",
      text: "text-category-cultural-text",
    },
    Religious: {
      bg: "bg-category-religious-bg",
      text: "text-category-religious-text",
    },
    "Advocacy & Causes": {
      bg: "bg-category-default-bg",
      text: "text-category-default-text",
    },
    "Sales & Fundraising": {
      bg: "bg-category-default-bg",
      text: "text-category-default-text",
    },
    Technology: { bg: "bg-category-technology-bg", text: "text-category-technology-text" },
    "Health & Wellness": { bg: "bg-category-health-bg", text: "text-category-health-text" },
    "Music & Performance": { bg: "bg-category-music-bg", text: "text-category-music-text" },
    Entrepreneurship: { bg: "bg-category-entrepreneurship-bg", text: "text-category-entrepreneurship-text" },
  };
  return (
    mapping[category] || {
      bg: "bg-category-default-bg",
      text: "text-category-default-text",
    }
  );
}
