import { basename, dirname } from 'node:path';

export type FeatureId = 
  | 'events-page'
  | 'admin-pages'
  | 'filters'
  | 'global-state'
  | 'event-forms'
  | 'onboarding'
  | 'i18n'
  | 'navigation'
  | 'modals'
  | 'ui-components'
  | 'other';

export interface FeatureInfo {
  id: FeatureId;
  name: string;
  files: string[];
}

export function detectFeature(filePath: string): FeatureId {
  const fileName = basename(filePath);
  const dir = dirname(filePath);
  
  if (fileName.includes('EventsPage') || fileName.includes('EventList')) {
    return 'events-page';
  }
  if (fileName.includes('Admin') && (fileName.includes('Page') || fileName.includes('Panel'))) {
    return 'admin-pages';
  }
  if (fileName.includes('Filter') || fileName.includes('useAppFilters') || fileName.includes('useFilters')) {
    return 'filters';
  }
  if (fileName.includes('useAppUI') || fileName.includes('useAppEvents') || fileName.includes('useAppPromotions')) {
    return 'global-state';
  }
  if (fileName.includes('EventForm') || fileName.includes('useEventForm') || fileName.includes('SubmitEvent')) {
    return 'event-forms';
  }
  if (fileName.includes('Onboarding') || fileName.includes('useOnboarding')) {
    return 'onboarding';
  }
  if (filePath.includes('locales') || fileName.includes('i18n') || fileName.includes('translation')) {
    return 'i18n';
  }
  if (fileName === 'App.tsx' || fileName.includes('Navigation') || fileName.includes('useAppNavigation')) {
    return 'navigation';
  }
  if (fileName.includes('Modal') && !fileName.includes('Onboarding')) {
    return 'modals';
  }
  if (dir.includes('ui/')) {
    const uiComponentNames = ['Button', 'Input', 'Select', 'Dialog', 'Card', 'Badge', 'Tabs', 'Tooltip', 'Popover'];
    if (uiComponentNames.some(name => fileName.includes(name))) {
      return 'ui-components';
    }
  }
  return 'other';
}

export function getFeatureFiles(featureId: FeatureId, projectDir: string): string[] {
  const featureMap: Record<FeatureId, string[]> = {
    'events-page': [
      'src/components/EventsPageContainer.tsx',
      'src/components/EventsPage.tsx',
      'src/components/EventList.tsx',
      'src/components/EventCard.tsx',
      'src/components/SearchBar.tsx',
      'src/components/EventCount.tsx',
    ],
    'admin-pages': [
      'src/components/AdminEventsPage.tsx',
      'src/components/AdminClubsPage.tsx',
      'src/components/AdminSubmissionsPage.tsx',
      'src/components/AdminPostersPage.tsx',
      'src/components/AdminPanel.tsx',
      'src/components/Admin/PostersTable.tsx',
    ],
    'filters': [
      'src/hooks/useFilters.ts',
      'src/hooks/useAppFilters.tsx',
      'src/components/VisualFilters.tsx',
      'src/components/FilterDropdown.tsx',
      'src/components/FilterSection.tsx',
      'src/components/QuickFilterChip.tsx',
      'src/components/MoreFiltersButton.tsx',
    ],
    'global-state': [
      'src/hooks/useAppUI.ts',
      'src/hooks/useAppEvents.ts',
      'src/hooks/useAppPromotions.ts',
      'src/hooks/useAppNavigation.ts',
      'src/App.tsx',
    ],
    'event-forms': [
      'src/components/EventForm/EventFormFields.tsx',
      'src/components/EventForm/EventFormPreview.tsx',
      'src/components/EventForm/EventFormJSON.tsx',
      'src/components/EventForm/PromotionUpsell.tsx',
      'src/components/SubmitEventModal.tsx',
      'src/hooks/useEventForm.ts',
      'src/hooks/useEventFormSubmission.ts',
      'src/hooks/useEventFormAI.ts',
      'src/hooks/useEventFormPromotion.ts',
    ],
    'onboarding': [
      'src/components/OnboardingModal.tsx',
      'src/hooks/useOnboardingForm.ts',
      'src/hooks/useOnboardingSteps.ts',
      'src/hooks/useOnboardingOTP.ts',
    ],
    'i18n': [
      'src/lib/i18n.ts',
      'src/locales/en.json',
      'src/locales/zh.json',
      'src/hooks/useTranslatedOptions.ts',
    ],
    'navigation': [
      'src/App.tsx',
      'src/hooks/useAppNavigation.ts',
      'src/components/AppLayout.tsx',
      'src/components/Sidebar.tsx',
      'src/components/TopNav.tsx',
    ],
    'modals': [
      'src/components/EventDetailsModal.tsx',
      'src/components/QRCodeDetailsModal.tsx',
      'src/components/BuyCreditsModal.tsx',
      'src/components/AddClubModal.tsx',
      'src/components/CreateQRCodeModal.tsx',
      'src/components/CommandPalette.tsx',
    ],
    'ui-components': [
      'src/components/ui/button.tsx',
      'src/components/ui/input.tsx',
      'src/components/ui/select.tsx',
      'src/components/ui/dialog.tsx',
      'src/components/ui/card.tsx',
      'src/components/ui/tabs.tsx',
    ],
    'other': [],
  };
  return featureMap[featureId] || [];
}

export function getFeatureInfo(featureId: FeatureId, projectDir: string): FeatureInfo {
  const featureNames: Record<FeatureId, string> = {
    'events-page': 'Events Page',
    'admin-pages': 'Admin Pages',
    'filters': 'Filters System',
    'global-state': 'Global State Management',
    'event-forms': 'Event Forms',
    'onboarding': 'Onboarding',
    'i18n': 'Translation/i18n',
    'navigation': 'Navigation & Routing',
    'modals': 'Modals',
    'ui-components': 'UI Components',
    'other': 'Other',
  };
  return {
    id: featureId,
    name: featureNames[featureId],
    files: getFeatureFiles(featureId, projectDir),
  };
}
