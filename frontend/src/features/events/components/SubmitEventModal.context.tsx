import React, { createContext, useContext } from "react";
import type { EventFormData } from "@/shared/types";

interface SubmitEventModalContextValue {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => number | Promise<number>;
  userCredits: number;
  onPromote?: (
    eventId: number,
    packageId: string,
    credits: number,
    duration: number
  ) => boolean;
  onBuyCredits?: () => void;
  editEventId?: number;
  initialData?: EventFormData;
  onUpdate?: (eventId: number, event: EventFormData) => void;
  isEditMode: boolean;
}

const SubmitEventModalContext = createContext<SubmitEventModalContextValue | null>(null);

export function SubmitEventModalProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: SubmitEventModalContextValue;
}) {
  return (
    <SubmitEventModalContext.Provider value={value}>
      {children}
    </SubmitEventModalContext.Provider>
  );
}

export function useSubmitEventModalContext() {
  const context = useContext(SubmitEventModalContext);
  if (!context) {
    throw new Error(
      "useSubmitEventModalContext must be used within SubmitEventModalProvider"
    );
  }
  return context;
}
