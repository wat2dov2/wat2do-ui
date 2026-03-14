import type { FilterState } from "@/shared/types/filter.types";

export interface FilterStateReducerState {
  searchQuery: string;
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  dateRange: Date | undefined;
  addedSince: Date | undefined;
  requiresRegistration: boolean;
  todayFilter: boolean;
  thisWeekFilter: boolean;
  freeFilter: boolean;
  freeFoodFilter: boolean;
  forYouFilter: boolean;
  includeFoods: boolean;
}

export type FilterStateAction =
  | { type: "SET_SEARCH_QUERY"; payload: string }
  | { type: "SET_CATEGORIES"; payload: string[] }
  | { type: "SET_LOCATIONS"; payload: string[] }
  | { type: "SET_FOODS"; payload: string[] }
  | { type: "SET_DAYS"; payload: string[] }
  | { type: "SET_PRICE_RANGE"; payload: { min: string; max: string } }
  | { type: "SET_DATE_RANGE"; payload: Date | undefined }
  | { type: "SET_ADDED_SINCE"; payload: Date | undefined }
  | { type: "SET_REQUIRES_REGISTRATION"; payload: boolean }
  | { type: "TOGGLE_CATEGORY"; payload: string }
  | { type: "TOGGLE_LOCATION"; payload: string }
  | { type: "TOGGLE_FOOD"; payload: string }
  | { type: "TOGGLE_DAY"; payload: string }
  | { type: "SET_TODAY_FILTER"; payload: boolean }
  | { type: "SET_THIS_WEEK_FILTER"; payload: boolean }
  | { type: "SET_FREE_FILTER"; payload: boolean }
  | { type: "SET_FREE_FOOD_FILTER"; payload: boolean }
  | { type: "SET_FOR_YOU_FILTER"; payload: boolean }
  | { type: "SET_INCLUDE_FOODS"; payload: boolean }
  | { type: "SET_FILTER_STATE"; payload: Partial<FilterStateReducerState> }
  | { type: "CLEAR_ALL_FILTERS" };

const initialState: FilterStateReducerState = {
  searchQuery: "",
  selectedCategories: [],
  selectedLocations: [],
  selectedFoods: [],
  selectedDays: [],
  priceRange: { min: "", max: "" },
  dateRange: undefined,
  addedSince: undefined,
  requiresRegistration: false,
  todayFilter: false,
  thisWeekFilter: false,
  freeFilter: false,
  freeFoodFilter: false,
  forYouFilter: false,
  includeFoods: false,
};

// Cleared state - all filters empty
const clearedState: FilterStateReducerState = {
  searchQuery: "",
  selectedCategories: [],
  selectedLocations: [],
  selectedFoods: [],
  selectedDays: [],
  priceRange: { min: "", max: "" },
  dateRange: undefined,
  addedSince: undefined,
  requiresRegistration: false,
  todayFilter: false,
  thisWeekFilter: false,
  freeFilter: false,
  freeFoodFilter: false,
  forYouFilter: false,
  includeFoods: false,
};

export function filterStateReducer(
  state: FilterStateReducerState,
  action: FilterStateAction
): FilterStateReducerState {
  switch (action.type) {
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.payload };
    case "SET_CATEGORIES":
      return { ...state, selectedCategories: action.payload };
    case "SET_LOCATIONS":
      return { ...state, selectedLocations: action.payload };
    case "SET_FOODS":
      return { ...state, selectedFoods: action.payload };
    case "SET_DAYS":
      return { ...state, selectedDays: action.payload };
    case "SET_PRICE_RANGE":
      return { ...state, priceRange: action.payload };
    case "SET_DATE_RANGE":
      return { ...state, dateRange: action.payload };
    case "SET_ADDED_SINCE":
      return { ...state, addedSince: action.payload };
    case "SET_REQUIRES_REGISTRATION":
      return { ...state, requiresRegistration: action.payload };
    case "TOGGLE_CATEGORY":
      return {
        ...state,
        selectedCategories: state.selectedCategories.includes(action.payload)
          ? state.selectedCategories.filter((c) => c !== action.payload)
          : [...state.selectedCategories, action.payload],
      };
    case "TOGGLE_LOCATION":
      return {
        ...state,
        selectedLocations: state.selectedLocations.includes(action.payload)
          ? state.selectedLocations.filter((l) => l !== action.payload)
          : [...state.selectedLocations, action.payload],
      };
    case "TOGGLE_FOOD":
      return {
        ...state,
        selectedFoods: state.selectedFoods.includes(action.payload)
          ? state.selectedFoods.filter((f) => f !== action.payload)
          : [...state.selectedFoods, action.payload],
      };
    case "TOGGLE_DAY":
      return {
        ...state,
        selectedDays: state.selectedDays.includes(action.payload)
          ? state.selectedDays.filter((d) => d !== action.payload)
          : [...state.selectedDays, action.payload],
      };
    case "SET_TODAY_FILTER":
      return { ...state, todayFilter: action.payload };
    case "SET_THIS_WEEK_FILTER":
      return { ...state, thisWeekFilter: action.payload };
    case "SET_FREE_FILTER":
      return { ...state, freeFilter: action.payload };
    case "SET_FREE_FOOD_FILTER":
      return { ...state, freeFoodFilter: action.payload };
    case "SET_FOR_YOU_FILTER":
      return { ...state, forYouFilter: action.payload };
    case "SET_INCLUDE_FOODS":
      return { ...state, includeFoods: action.payload };
    case "SET_FILTER_STATE":
      return { ...state, ...action.payload };
    case "CLEAR_ALL_FILTERS":
      return clearedState;
    default:
      return state;
  }
}

export { initialState, clearedState };
