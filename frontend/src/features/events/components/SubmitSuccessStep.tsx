import { EventSuccessScreen } from "@/features/events/components/EventForm/EventForm/EventSuccessScreen";

interface SubmitSuccessStepProps {
  isOpen: boolean;
  onClose: () => void;
  onPromote?: () => void;
  isEditMode: boolean;
  isSubmissionOnly: boolean;
}

export function SubmitSuccessStep({
  isOpen,
  onClose,
  onPromote,
  isEditMode,
  isSubmissionOnly,
}: SubmitSuccessStepProps) {
  return (
    <EventSuccessScreen
      isOpen={isOpen}
      onClose={onClose}
      onPromote={onPromote}
      isEditMode={isEditMode}
      isSubmissionOnly={isSubmissionOnly}
    />
  );
}
