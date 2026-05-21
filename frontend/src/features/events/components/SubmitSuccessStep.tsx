import { EventSuccessScreen } from "@/features/events/components/EventForm/EventForm/EventSuccessScreen";

interface SubmitSuccessStepProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote?: () => void;
  isEditMode: boolean;
  isSubmissionOnly: boolean;
  onShowSuccessAlert: (title: string, message: string) => void;
}

export function SubmitSuccessStep({
  isOpen,
  onClose,
  onPromote,
  isEditMode,
  isSubmissionOnly,
  onShowSuccessAlert,
}: SubmitSuccessStepProps) {
  return (
    <EventSuccessScreen
      isOpen={isOpen}
      onClose={onClose}
      onPromote={onPromote}
      isEditMode={isEditMode}
      isSubmissionOnly={isSubmissionOnly}
      onShowSuccessAlert={onShowSuccessAlert}
    />
  );
}
