import React, { createContext, useContext } from "react";
import type { QRCode, Event } from "@/shared/types";

interface QRCodeDetailsModalContextValue {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
  events: Event[];
}

const QRCodeDetailsModalContext = createContext<QRCodeDetailsModalContextValue | null>(null);

export function QRCodeDetailsModalProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: QRCodeDetailsModalContextValue;
}) {
  return (
    <QRCodeDetailsModalContext.Provider value={value}>
      {children}
    </QRCodeDetailsModalContext.Provider>
  );
}

export function useQRCodeDetailsModalContext() {
  const context = useContext(QRCodeDetailsModalContext);
  if (!context) {
    throw new Error(
      "useQRCodeDetailsModalContext must be used within QRCodeDetailsModalProvider"
    );
  }
  return context;
}
