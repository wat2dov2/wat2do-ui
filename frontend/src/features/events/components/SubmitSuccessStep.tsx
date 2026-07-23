import { EventSuccessScreen } from "@/features/events/components/EventForm/EventForm/EventSuccessScreen";

interface SubmitSuccessStepProps {
  onClose: () => void;
  onPromote?: () => void;
  isEditMode: boolean;
  isSubmissionOnly: boolean;
}

export function SubmitSuccessStep({
  onClose,
  onPromote,
  isEditMode,
  isSubmissionOnly,
}: SubmitSuccessStepProps) {
  return (
    <EventSuccessScreen
      onClose={onClose}
      onPromote={onPromote}
      isEditMode={isEditMode}
      isSubmissionOnly={isSubmissionOnly}
    />
  );
}
