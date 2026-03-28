import React, { useState, useEffect } from "react";
import { Check, X } from "lucide-react";

interface Toast {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
}

let toastListeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];

function notifyListeners() {
  toastListeners.forEach((listener) => listener([...toasts]));
}

// eslint-disable-next-line react-refresh/only-export-components
export function showToast(message: string, type: "success" | "error" | "info" = "success") {
  const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const newToast: Toast = { id, message, type };
  toasts = [...toasts, newToast];
  notifyListeners();

  // Auto remove after 3 seconds
  setTimeout(() => {
    removeToast(id);
  }, 3000);
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notifyListeners();
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const [toastList, setToastList] = useState<Toast[]>(toasts);

  useEffect(() => {
    const listener = (newToasts: Toast[]) => {
      setToastList(newToasts);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  return toastList;
}

export function ToastContainer() {
  const toasts = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger animation
    setTimeout(() => setIsVisible(true), 10);
  }, []);

  const toneClass =
    toast.type === "success"
      ? "bg-success text-success-foreground"
      : toast.type === "error"
      ? "bg-error text-error-foreground"
      : "bg-primary text-primary-foreground";

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg min-w-[300px] max-w-md
        transition-all duration-300 ease-out
        ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full"}
        ${toneClass}
      `}
    >
      {toast.type === "success" && <Check className="w-5 h-5 shrink-0" />}
      {toast.type === "error" && <X className="w-5 h-5 shrink-0" />}
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={() => {
          removeToast(toast.id);
        }}
        className="shrink-0 hover:bg-foreground/20 rounded p-1 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
