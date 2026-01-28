/**
 * Auth Feature
 * Public API for authentication and onboarding
 * 
 * This is the feature's public interface.
 * Other features should only import from here.
 */

// Components
export { OnboardingModal } from "./components/OnboardingModal";
export { GettingStartedChecklist } from "./components/GettingStartedChecklist";

// API (public interface)
export { 
  login, 
  logout, 
  getSession,
  getUserProfile,
  updateUserProfile,
  isAuthenticated,
  isProfileCompleted,
  type UserProfile,
} from "./api/auth.api";

// Checklist API
export {
  loadChecklist,
  saveChecklist,
  removeChecklist,
  hasChecklist,
  type ChecklistItem,
  type ChecklistData,
} from "./api/checklist.api";
