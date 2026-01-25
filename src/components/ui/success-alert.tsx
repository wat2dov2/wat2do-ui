import React from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";

interface SuccessAlertProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
}

export function SuccessAlert({
  isOpen,
  onClose,
  title,
  message,
}: SuccessAlertProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-white" strokeWidth={3} />
            </div>
            <DialogTitle className="text-xl font-bold text-foreground mb-2">
              {title}
            </DialogTitle>
            <DialogDescription className="text-base">
              {message}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="flex justify-end mt-4">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
