"use client";

import { AppPage } from "@/app/app-page";
import {
  AdminEventsRoute,
  AdminInstagramRoute,
  AdminOrganizationsRoute,
  AdminPanelRoute,
  AdminPostersRoute,
} from "@/app/routes/adminRoutes";
import {
  OrganizationPanelIntegrationsRoute,
  OrganizationPanelMembersRoute,
  OrganizationPanelPostersRoute,
  OrganizationPanelRoute,
} from "@/app/routes/organizationPanelRoutes";
import { AuthCallbackPage } from "@/features/auth/pages/AuthCallbackPage";
import { AuthEntryPage } from "@/features/auth/pages/AuthEntryPage";
import { useUserEmail } from "@/features/auth";
import { ContactPage } from "@/features/contact/pages/ContactPage";
import { useEventsStore } from "@/features/events";
import { EventDetailsPageContainer } from "@/features/events/pages/EventDetailsPageContainer";
import { SubmitEventPage } from "@/features/events/pages/SubmitEventPage";
import { MarketingPage } from "@/features/marketing/pages/MarketingPage";
import { DesignSystemPage } from "@/features/design-system";
import { OnboardingDemoPage } from "@/features/onboarding-demo";
import { OnboardingPage } from "@/features/onboarding/pages/OnboardingPage";
import { CreateOrganizationPage } from "@/features/organizations/pages/CreateOrganizationPage";
import { OrganizationDetailsPage } from "@/features/organizations/pages/OrganizationDetailsPage";
import { OrganizationsPage } from "@/features/organizations/pages/OrganizationsPage";
import { InviteLandingPage } from "@/features/organizations/pages/InviteLandingPage";
import { QRRedirectPage } from "@/features/qrcode/pages/QRRedirectPage";
import { SettingsPage } from "@/features/settings/pages/SettingsPage";
import { ROLE_ADMIN, ROLE_ORGANIZATION } from "@/shared/constants/roles";
import type { Event } from "@/shared/types";

export function LoginRoute({ previewEvents = [] }: { previewEvents?: Event[] }) {
  return (
    <AppPage authFlow chrome={false}>
      <AuthEntryPage previewEvents={previewEvents} />
    </AppPage>
  );
}

export function AuthCallbackRoute() {
  return (
    <AppPage authFlow chrome={false}>
      <AuthCallbackPage />
    </AppPage>
  );
}

export function OnboardingRoute() {
  return (
    <AppPage authFlow chrome={false}>
      <OnboardingPage />
    </AppPage>
  );
}

export function OnboardingDemoRoute() {
  return (
    <AppPage authFlow chrome={false}>
      <OnboardingDemoPage />
    </AppPage>
  );
}

export function DesignSystemRoute() {
  return (
    <AppPage chrome={false}>
      <DesignSystemPage />
    </AppPage>
  );
}

export function ContactRoute() {
  return (
    <AppPage>
      <ContactPage />
    </AppPage>
  );
}

export function OrganizationsRoute() {
  return (
    <AppPage>
      <OrganizationsPage />
    </AppPage>
  );
}

export function CreateOrganizationRoute() {
  return (
    <AppPage requiresAuth>
      <CreateOrganizationPage />
    </AppPage>
  );
}

export function OrganizationDetailsRoute({
  organizationId,
}: {
  organizationId: number;
}) {
  return (
    <AppPage>
      <OrganizationDetailsPage organizationId={organizationId} />
    </AppPage>
  );
}

export function InviteRoute() {
  return (
    <AppPage chrome={false}>
      <InviteLandingPage />
    </AppPage>
  );
}

export function SettingsRoute() {
  return (
    <AppPage requiresAuth>
      <SettingsPage />
    </AppPage>
  );
}

export function AdminRoute() {
  return (
    <AppPage requiredRole={ROLE_ADMIN}>
      <AdminPanelRoute />
    </AppPage>
  );
}

export function AdminEventsPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ADMIN}>
      <AdminEventsRoute />
    </AppPage>
  );
}

export function AdminOrganizationsPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ADMIN}>
      <AdminOrganizationsRoute />
    </AppPage>
  );
}

export function AdminPostersPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ADMIN}>
      <AdminPostersRoute />
    </AppPage>
  );
}

export function AdminInstagramPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ADMIN}>
      <AdminInstagramRoute />
    </AppPage>
  );
}

export function MarketingRoute() {
  const events = useEventsStore((s) => s.events);
  const userEmail = useUserEmail();

  return (
    <AppPage requiredRole={ROLE_ADMIN}>
      <MarketingPage events={events} userEmail={userEmail || ""} />
    </AppPage>
  );
}

export function OrganizationPanelPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ORGANIZATION}>
      <OrganizationPanelRoute />
    </AppPage>
  );
}

export function OrganizationPanelPostersPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ORGANIZATION}>
      <OrganizationPanelPostersRoute />
    </AppPage>
  );
}

export function OrganizationPanelIntegrationsPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ORGANIZATION}>
      <OrganizationPanelIntegrationsRoute />
    </AppPage>
  );
}

export function OrganizationPanelMembersPageRoute() {
  return (
    <AppPage requiredRole={ROLE_ORGANIZATION}>
      <OrganizationPanelMembersRoute />
    </AppPage>
  );
}

export function EventDetailsPageRoute({ eventId }: { eventId: number }) {
  return (
    <AppPage>
      <EventDetailsPageContainer eventId={eventId} />
    </AppPage>
  );
}

export function SubmitEventPageRoute() {
  return (
    <AppPage requiresAuth>
      <SubmitEventPage />
    </AppPage>
  );
}

export function QRRoute() {
  return (
    <AppPage chrome={false} skipSchoolCheck>
      <QRRedirectPage />
    </AppPage>
  );
}
