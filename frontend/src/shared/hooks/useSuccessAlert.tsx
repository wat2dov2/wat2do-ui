import { useState, useCallback } from "react";
import { SuccessAlert } from "@/shared/ui/success-alert";

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
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);

  const show = useCallback((alertTitle: string, alertMessage: string) => {
    setAlert({ title: alertTitle, message: alertMessage });
  }, []);

  const hide = useCallback(() => {
    setAlert(null);
  }, []);

  const SuccessAlertComponent = useCallback(
    ({ onClose }: { onClose?: () => void }) => {
      return (
        <SuccessAlert
          isOpen={alert !== null}
          onClose={() => {
            hide();
            if (onClose) {
              onClose();
            }
            if (onCloseCallback) {
              onCloseCallback();
            }
          }}
          title={alert?.title ?? ""}
          message={alert?.message ?? ""}
        />
      );
    },
    [alert, hide, onCloseCallback]
  );

  return { show, hide, SuccessAlertComponent };
}
