export interface ApprovedPosterTemplate {
  id: string;
  name: string;
  assetPath: string;
  eligibleSchool: string;
  printSize: "us-letter";
  orientation: "portrait";
  qrPlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  previewDescription: string;
  availableForCreation: boolean;
}

interface PublicPromoterProgram {
  enabled: boolean;
  rateCents: number;
  landingConfirmationSeconds: number;
  payoutDayOfMonth: number;
  quietPosterDays: number;
  bannerDismissalDays: number;
  tosVersion: string;
  discordInviteUrl: string;
  approvedTemplates: ApprovedPosterTemplate[];
}

const serializedPromoterProgram = process.env.NEXT_PUBLIC_PROMOTER_PROGRAM;
if (!serializedPromoterProgram) {
  throw new Error("NEXT_PUBLIC_PROMOTER_PROGRAM is required");
}

export const promoterProgram = JSON.parse(
  serializedPromoterProgram,
) as PublicPromoterProgram;
