/**
 * Credit Package Card Component
 * Reusable component for credit package selection
 */

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface CreditPackageCardProps {
  package: {
    credits: number;
    bonus?: number;
    price: number;
    popular?: boolean;
  };
  isSelected: boolean;
  onClick: () => void;
  popularLabel: string;
}

export function CreditPackageCard({
  package: pkg,
  isSelected,
  onClick,
  popularLabel,
}: CreditPackageCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-4 rounded-lg border-2 text-left transition-all relative",
        isSelected
          ? "border-warning bg-amber-100"
          : "border-border hover:border-amber-300"
      )}
    >
      {pkg.popular && (
        <div className="absolute -top-2 left-4 bg-warning text-white text-[10px] font-bold px-2 py-0.5 rounded">
          {popularLabel}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-5 h-5 rounded-full border-2 flex items-center justify-center",
              isSelected ? "border-warning bg-warning" : "border-gray-300"
            )}
          >
            {isSelected && (
              <Check className="w-3 h-3 text-white" strokeWidth={3} />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {pkg.credits} credits
              </span>
              {pkg.bonus && (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                  +{pkg.bonus} bonus
                </span>
              )}
            </div>
            {pkg.bonus && (
              <p className="text-xs text-muted-foreground">
                {pkg.credits + pkg.bonus} total credits
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="font-bold text-foreground">${pkg.price}</p>
          <p className="text-xs text-muted-foreground">
            ${((pkg.price / (pkg.credits + (pkg.bonus || 0))) * 100).toFixed(1)}¢/credit
          </p>
        </div>
      </div>
    </button>
  );
}
