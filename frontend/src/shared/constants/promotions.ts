import type { CreditPackageInfo, PromotionPackageInfo } from "@/shared/types/promotion.types";

export const EVENT_PROMOTION: PromotionPackageInfo = {
  id: "featured",
  nameKey: "promotion.promotedEventName",
  descriptionKey: "promotion.promotedEventDescription",
  credits: 50,
  duration: 7,
};

export const PROMOTION_PACKAGES: PromotionPackageInfo[] = [EVENT_PROMOTION];

export const CREDIT_PACKAGES: CreditPackageInfo[] = [
  { credits: 100, price: 5, popular: false },
  { credits: 250, price: 10, popular: true, bonus: 50 },
  { credits: 500, price: 18, popular: false, bonus: 100 },
];
