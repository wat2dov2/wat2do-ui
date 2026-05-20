/**
 * Promotion-related types
 */

export type PromotionPackage = "featured" | "email" | "combo";

export interface PromotionPackageInfo {
  id: PromotionPackage;
  name: string;
  description: string;
  credits: number;
  duration: number; // days
  originalCredits?: number; // for showing discount
}

export interface CreditPackageInfo {
  credits: number;
  price: number;
  popular: boolean;
  bonus?: number;
}

export { CREDIT_PACKAGES, PROMOTION_PACKAGES } from "@/shared/constants/promotions";
