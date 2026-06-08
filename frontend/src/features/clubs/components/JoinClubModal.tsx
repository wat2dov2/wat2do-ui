import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Textarea } from "@/shared/ui/textarea";
import {
  Field,
  FieldLabel,
  FieldGroup,
} from "@/shared/ui/field";
import { toast } from "@/shared/hooks/use-toast";
import type { Club } from "@/shared/types";
import { api } from "@/shared/services/apiClient";

interface JoinClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  club: Club;
}

export function JoinClubModal({ isOpen, onClose, club }: JoinClubModalProps) {
  const { t } = useTranslation();
  const [pitch, setPitch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pitch.trim().length < 10) {
      toast({
        title: t("common.error") || "Error",
        description: "Please write a pitch of at least 10 characters.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/clubs/${club.id}/join-requests`, {
        pitch: pitch.trim(),
      });

      toast({
        title: "Application Sent",
        description: `Your request to join "${club.club_name}" has been sent to the club management team.`,
        variant: "success",
      });
      onClose();
    } catch {
      toast({
        title: t("common.error") || "Error",
        description: "Failed to send application. You may have already applied to this club.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Join Executive/Management Team</DialogTitle>
          <DialogDescription>
            Apply to become part of the organizing team for <strong>{club.club_name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="join-pitch">
                Brief Pitch <span className="text-destructive">*</span>
              </FieldLabel>
              <Textarea
                id="join-pitch"
                placeholder="Tell the executives why you'd like to join and what you can contribute..."
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                disabled={isSubmitting}
                className="min-h-28"
                maxLength={1000}
                required
              />
              <p className="text-xs text-muted-foreground text-right mt-1">
                {pitch.trim().length}/1000 characters (minimum 10)
              </p>
            </Field>

            <DialogFooter className="pt-4 gap-2 flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton
                type="submit"
                disabled={pitch.trim().length < 10}
                isLoading={isSubmitting}
                loadingText="Sending..."
              >
                Submit Application
              </LoadingButton>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
