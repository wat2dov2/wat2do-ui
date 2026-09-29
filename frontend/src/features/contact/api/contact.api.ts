import contactControl from "../../../../../backend/controlbox/contact.json" with { type: "json" };
import type { SchoolSummary } from "@/shared/api/schools.api";
import type { components } from "@/shared/generated/api-types";
import { api } from "@/shared/services/apiClient";

export type ContactMessage = components["schemas"]["ContactCreate"];

export interface BusinessSupportNomination {
  businessName: string;
  location: string;
  website: string;
  discount: string;
  reasonForSupport: string;
  proposedBannerText: string;
  studentTrafficPerWeek: string;
  email: string;
}

export const BUSINESS_SUPPORT_FIELD_LIMITS = {
  businessName: contactControl.business_support.business_name,
  location: contactControl.business_support.location,
  website: contactControl.business_support.website,
  discount: contactControl.business_support.discount,
  reasonForSupport: contactControl.business_support.reason_for_support,
  proposedBannerText: contactControl.business_support.proposed_banner_text,
  studentTrafficPerWeek: contactControl.business_support.student_traffic_per_week,
  email: contactControl.business_support.email,
} satisfies Record<keyof BusinessSupportNomination, number>;

/** The existing contact inbox receives one readable nomination, with campus context. */
export function buildBusinessSupportMessage(
  nomination: BusinessSupportNomination,
  school: SchoolSummary | undefined,
): ContactMessage {
  const message = [
    "Local business banner nomination",
    `Business: ${nomination.businessName.trim()}`,
    `Location or address: ${nomination.location.trim()}`,
    `Website or social link: ${nomination.website.trim() || "Not provided"}`,
    `Discount for wat2do users: ${nomination.discount.trim() || "Not provided"}`,
    `Why support is needed:\n${nomination.reasonForSupport.trim()}`,
    `Suggested banner text:\n${nomination.proposedBannerText.trim()}`,
    `Estimated student visits per week: ${nomination.studentTrafficPerWeek.trim()}`,
    `Campus: ${school ? school.name : "Not selected"}`,
    `City: ${school?.city?.trim() || "Not specified"}`,
  ].join("\n\n");

  if (message.length > contactControl.maximum_message_length) {
    throw new RangeError("Business nomination exceeds the contact message limit");
  }

  return { email: nomination.email.trim(), message };
}

export async function submitContactMessage(
  message: ContactMessage,
): Promise<void> {
  await api.post<components["schemas"]["MessageResponse"]>(
    "/contact/",
    message,
  );
}

export async function submitBusinessSupportNomination(
  nomination: BusinessSupportNomination,
  school: SchoolSummary,
): Promise<void> {
  const payload: components["schemas"]["SponsorSubmissionCreate"] = {
    ...buildBusinessSupportMessage(nomination, school),
    business_name: nomination.businessName.trim(),
    school: school.slug,
  };
  await api.post<components["schemas"]["MessageResponse"]>("/sponsor-submissions/", payload);
}
