import { EventSuccessScreen } from "@/features/events/components/EventForm/EventForm/EventSuccessScreen";

interface SubmitSuccessStepProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote?: () => void;
  isEditMode: boolean;
  onShowSuccessAlert: (message: string) => void;
}

export function SubmitSuccessStep({
  isOpen,
  onClose,
  onPromote,
  isEditMode,
  onShowSuccessAlert,
}: SubmitSuccessStepProps) {
  return (
    <EventSuccessScreen
      isOpen={isOpen}
      onClose={onClose}
      onPromote={onPromote}
      isEditMode={isEditMode}
      onShowSuccessAlert={onShowSuccessAlert}
    />
  );
}
