/**
 * Utility function to convert EventSubmission to Event data
 * Extracted from App.tsx to reduce code duplication
 */

import type { EventSubmission, EventFormData } from "@/shared/types";
import { DEFAULT_EVENT_CATEGORY } from "@/shared/constants/eventCategories";

/**
 * Converts an EventSubmission to EventFormData for creating a new event
 * Handles type conversion (e.g., food string to string[])
 */
export function submissionToEventData(submission: EventSubmission): EventFormData {
  const eventData = submission.eventData;
  
  // Convert food to array if it's a string
  const foodArray = Array.isArray(eventData.food)
    ? eventData.food
    : eventData.food
    ? [eventData.food]
    : [];
  
  return {
    title: eventData.title,
    description: eventData.description,
    date: eventData.date,
    time: eventData.time,
    location: eventData.location,
    category: eventData.category || DEFAULT_EVENT_CATEGORY,
    price: eventData.price,
    food: foodArray,
    requiresRegistration: eventData.requiresRegistration,
    organization: eventData.organization,
  };
}
