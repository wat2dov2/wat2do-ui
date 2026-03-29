import React, { createContext, useContext } from "react";
import type { QRCode, Event } from "@/shared/types";

interface CreateQRCodeModalContextValue {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (qrCode: QRCode) => void;
  events: Event[];
  userEmail: string;
}

const CreateQRCodeModalContext = createContext<CreateQRCodeModalContextValue | null>(null);

export function CreateQRCodeModalProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: CreateQRCodeModalContextValue;
}) {
  return (
    <CreateQRCodeModalContext.Provider value={value}>
      {children}
    </CreateQRCodeModalContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCreateQRCodeModalContext() {
  const context = useContext(CreateQRCodeModalContext);
  if (!context) {
    throw new Error(
      "useCreateQRCodeModalContext must be used within CreateQRCodeModalProvider"
    );
  }
  return context;
}
