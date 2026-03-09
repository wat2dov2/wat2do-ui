import React from "react";
import { Check } from "lucide-react";

// Reusable package card component
interface PackageCardProps {
  isSelected: boolean;
  affordable: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: React.ReactNode;
}

export function PackageCard({
  isSelected,
  affordable,
  onClick,
  children,
  badge,
}: PackageCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full p-4 rounded-lg border-2 text-left transition-all relative ${
        isSelected
          ? "border-primary bg-primary/10"
          : affordable
          ? "border-border hover:border-primary/50"
          : "border-border opacity-60"
      }`}
      disabled={!affordable}
    >
      {badge}
      {children}
    </button>
  );
}

// Package badge component
interface PackageBadgeProps {
  children: React.ReactNode;
}

export function PackageBadge({ children }: PackageBadgeProps) {
  return (
    <div className="absolute -top-2 left-4 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded">
      {children}
    </div>
  );
}

// Radio button component
interface RadioButtonProps {
  isSelected: boolean;
}

export function RadioButton({ isSelected }: RadioButtonProps) {
  return (
    <div
      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
        isSelected ? "border-primary bg-primary" : "border-border"
      }`}
    >
      {isSelected && (
        <Check className="w-3 h-3 text-white" strokeWidth={3} />
      )}
    </div>
  );
}

// Credits display component
interface CreditsDisplayProps {
  credits: number;
  originalCredits?: number;
  duration: number;
  icon?: React.ReactNode;
}

export function CreditsDisplay({
  credits,
  originalCredits,
  duration,
  icon,
}: CreditsDisplayProps) {
  return (
    <div className="text-right">
      <div className="flex items-center gap-1">
        {icon}
        <span className="font-bold text-foreground">{credits}</span>
      </div>
      {originalCredits && (
        <p className="text-xs text-muted-foreground line-through">
          {originalCredits} credits
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {duration} day{duration > 1 ? "s" : ""}
      </p>
    </div>
  );
}

// Credits balance component
interface CreditsBalanceProps {
  credits: number;
  onBuyMore: () => void;
}

export function CreditsBalance({ credits, onBuyMore }: CreditsBalanceProps) {
  return (
    <div className="flex items-center justify-between bg-warning/20 px-4 py-2 rounded-lg">
      <div className="flex items-center gap-2">
        {/* Coins icon will be passed from parent */}
        <span className="font-semibold text-warning">{credits} credits</span>
      </div>
      <button
        type="button"
        onClick={onBuyMore}
        className="text-xs font-medium text-warning hover:text-warning/80 h-auto p-0"
      >
        + Buy more
      </button>
    </div>
  );
}
