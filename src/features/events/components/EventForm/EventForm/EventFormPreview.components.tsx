import React from "react";

// Reusable badge component
interface BadgeProps {
  children: React.ReactNode;
  variant?: "success" | "primary" | "warning";
  className?: string;
}

export function Badge({ children, variant = "primary", className = "" }: BadgeProps) {
  const variantClasses = {
    success: "bg-success/20 text-success",
    primary: "bg-primary/20 text-primary",
    warning: "bg-warning/20 text-warning",
  };

  return (
    <span
      className={`font-medium text-[10px] px-2 py-0.5 rounded-xl ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

// Reusable info row component
interface InfoRowProps {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}

export function InfoRow({ icon: Icon, children }: InfoRowProps) {
  return (
    <div className="flex gap-1.5 items-center">
      <Icon className="w-3 h-3 shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="text-[11px] truncate text-muted-foreground">{children}</span>
    </div>
  );
}

// Reusable preview card container
interface PreviewCardProps {
  children: React.ReactNode;
}

export function PreviewCard({ children }: PreviewCardProps) {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
      {children}
    </div>
  );
}

// Reusable image area component
interface ImageAreaProps {
  children: React.ReactNode;
}

export function ImageArea({ children }: ImageAreaProps) {
  return (
    <div className="relative h-32 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
      {children}
    </div>
  );
}

// Reusable club badge component
interface ClubBadgeProps {
  organization: string;
  fallback: string;
}

export function ClubBadge({ organization, fallback }: ClubBadgeProps) {
  return (
    <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2">
      <div className="w-7 h-7 rounded-full border-2 border-card shadow-lg flex items-center justify-center flex-shrink-0 bg-card bg-gradient-to-br from-primary/20 to-primary/10">
        {/* Icon will be passed as children if needed */}
      </div>
      <span className="font-bold text-[10px] text-white truncate max-w-[100px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.4)]">
        {organization || fallback}
      </span>
    </div>
  );
}
