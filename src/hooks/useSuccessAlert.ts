import { useState, useCallback } from "react";
import { SuccessAlert } from "@/components/ui/success-alert";

interface UseSuccessAlertOptions {
  onClose?: () => void; // Optional callback when alert closes
}

interface UseSuccessAlertReturn {
  show: (title: string, message: string) => void;
  hide: () => void;
  SuccessAlertComponent: React.ComponentType<{ onClose?: () => void }>;
}

/**
 * Hook for managing success alerts in modals
 * Eliminates duplicate state management for success alerts
 */
export function useSuccessAlert(
  options?: UseSuccessAlertOptions
): UseSuccessAlertReturn {
  const { onClose: onCloseCallback } = options || {};
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  const show = useCallback((alertTitle: string, alertMessage: string) => {
    setTitle(alertTitle);
    setMessage(alertMessage);
    setIsOpen(true);
  }, []);

  const hide = useCallback(() => {
    setIsOpen(false);
    setTitle("");
    setMessage("");
  }, []);

  const SuccessAlertComponent = useCallback(
    ({ onClose }: { onClose?: () => void }) => {
      return (
        <SuccessAlert
          isOpen={isOpen}
          onClose={() => {
            hide();
            if (onClose) {
              onClose();
            }
            if (onCloseCallback) {
              onCloseCallback();
            }
          }}
          title={title}
          message={message}
        />
      );
    },
    [isOpen, title, message, hide, onCloseCallback]
  );

  return { show, hide, SuccessAlertComponent };
}
