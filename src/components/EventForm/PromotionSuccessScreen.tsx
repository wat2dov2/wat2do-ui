import React from "react";
import { Check, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EventFormData } from "@/types";

interface PromotionSuccessScreenProps {
  isOpen: boolean;
  onClose: () => void;
  formData: EventFormData;
  userCredits: number;
}

export function PromotionSuccessScreen({
  isOpen,
  onClose,
  formData,
  userCredits,
}: PromotionSuccessScreenProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">Event Promoted</DialogTitle>
        <div className="flex flex-col items-center text-center py-6 space-y-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Check className="w-8 h-8 text-white" strokeWidth={3} />
          </div>

          <h2 className="text-xl font-bold text-foreground">
            Event Promoted!
          </h2>
          <p className="text-muted-foreground text-sm">
            "{formData.title}" is now featured and will appear at the top of
            search results.
          </p>

          <div className="flex items-center gap-2 bg-warning/20 px-4 py-2 rounded-full">
            <Coins className="w-5 h-5 text-warning" />
            <span className="font-bold text-warning">
              {userCredits} credits remaining
            </span>
          </div>

          <Button onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
