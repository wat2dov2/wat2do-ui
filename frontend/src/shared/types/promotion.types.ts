/**
 * Promotion-related types
 */

export type PromotionPackage = "featured";

export interface PromotionPackageInfo {
  id: PromotionPackage;
  name: string;
  description: string;
  credits: number;
  duration: number; // days
}

export interface CreditPackageInfo {
  credits: number;
  price: number;
  popular: boolean;
  bonus?: number;
}

export { CREDIT_PACKAGES, EVENT_PROMOTION, PROMOTION_PACKAGES } from "@/shared/constants/promotions";
