import React, { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Download, Check, Circle, ImagePlus, Image as ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QRCode, Event, FilterState } from "@/types";
import { generateQRCodeUrl, downloadQRCodeAsPNG } from "@/utils/qrGenerator";
import { saveQRCode } from "@/utils/qrRedirect";

interface CreateQRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (qrCode: QRCode) => void;
  events: Event[];
  userEmail: string;
}

export function CreateQRCodeModal({
  isOpen,
  onClose,
  onCreate,
  events,
  userEmail,
}: CreateQRCodeModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [destinationType, setDestinationType] = useState<
    "event" | "events-list" | "custom-url"
  >("event");
  const [selectedEventId, setSelectedEventId] = useState<number | undefined>();
  const [customUrl, setCustomUrl] = useState("");
  const [filters, setFilters] = useState<FilterState | undefined>();
  const [qrCodeId, setQrCodeId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageUrl, setImageUrl] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      // Reset form when modal closes
      setName("");
      setDescription("");
      setDestinationType("event");
      setSelectedEventId(undefined);
      setCustomUrl("");
      setFilters(undefined);
      setQrCodeId(null);
      setErrors({});
      setImageUrl("");
      setImagePreview("");
    }
  }, [isOpen]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setErrors((prev) => ({ ...prev, image: "Please select an image file" }));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        image: "Image must be less than 5MB",
      }));
      return;
    }

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImageUrl(dataUrl);
      setImagePreview(dataUrl);
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.image;
        return newErrors;
      });
    };
    reader.onerror = () => {
      setErrors((prev) => ({
        ...prev,
        image: "Failed to read image file",
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImageUrl("");
    setImagePreview("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = "Name is required";
    }
    if (destinationType === "event" && !selectedEventId) {
      newErrors.event = "Please select an event";
    }
    if (destinationType === "custom-url" && !customUrl.trim()) {
      newErrors.url = "URL is required";
    }
    if (destinationType === "custom-url" && customUrl.trim()) {
      try {
        new URL(customUrl);
      } catch {
        newErrors.url = "Please enter a valid URL";
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleGenerate = () => {
    if (!validate()) return;

    const newQRCode: QRCode = {
      id: `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      description: description.trim() || undefined,
      destinationType,
      destinationId:
        destinationType === "event"
          ? selectedEventId
          : destinationType === "custom-url"
          ? customUrl.trim()
          : undefined,
      filters: destinationType === "events-list" ? filters : undefined,
      createdAt: new Date().toISOString(),
      createdBy: userEmail,
      isActive: true,
      imageUrl: imageUrl || undefined,
    };

    saveQRCode(newQRCode);
    setQrCodeId(newQRCode.id);
    onCreate(newQRCode);
  };

  const handleDownload = () => {
    if (!qrCodeId) return;
    const qrUrl = generateQRCodeUrl(qrCodeId);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Create a temporary SVG element to render
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "512");
    svg.setAttribute("height", "512");
    const qrElement = document.createElement("div");
    qrElement.innerHTML = `<QRCodeSVG value="${qrUrl}" size={512} />`;
    
    // For now, use a simpler approach - create image from data URL
    // We'll use the QRCodeSVG component for display and a workaround for download
    const img = new Image();
    img.onload = () => {
      canvas.width = 512;
      canvas.height = 512;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      downloadQRCodeAsPNG(dataUrl, name.trim() || "qr-code");
    };
    // This is a simplified version - in production you'd properly render the SVG
    // For now, we'll use a different approach
  };

  const qrUrl = qrCodeId ? generateQRCodeUrl(qrCodeId) : "";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create QR Code</DialogTitle>
          <DialogDescription>
            Generate a unique QR code for your physical poster
          </DialogDescription>
        </DialogHeader>

        {!qrCodeId ? (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Poster Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Main Campus Poster #1"
                className={errors.name ? "border-red-500" : ""}
              />
              {errors.name && (
                <p className="text-xs text-red-500">{errors.name}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Description (Optional)
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of where this poster will be placed"
              />
            </div>

            {/* Image Upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Poster Image (Optional)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              {imagePreview ? (
                <div className="relative">
                  <div className="relative w-full h-48 rounded-xl overflow-hidden border border-border">
                    <img
                      src={imagePreview}
                      alt="Poster preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveImage}
                    className="absolute top-2 right-2"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer bg-muted/50 hover:bg-muted"
                >
                  <ImagePlus className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    Click to upload image
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG up to 5MB
                  </p>
                </button>
              )}
              {errors.image && (
                <p className="text-xs text-red-500">{errors.image}</p>
              )}
            </div>

            {/* Destination Type */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">
                Destination <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 p-3 border border-border rounded-xl cursor-pointer hover:bg-muted">
                  <div className="relative">
                    <input
                      type="radio"
                      name="destinationType"
                      value="event"
                      checked={destinationType === "event"}
                      onChange={() => setDestinationType("event")}
                      className="sr-only"
                    />
                    <Circle
                      className={`w-4 h-4 ${
                        destinationType === "event" ? "text-primary fill-primary" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">Specific Event</div>
                    <div className="text-xs text-muted-foreground">
                      Redirect to a specific event page
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-3 border border-border rounded-xl cursor-pointer hover:bg-muted">
                  <div className="relative">
                    <input
                      type="radio"
                      name="destinationType"
                      value="events-list"
                      checked={destinationType === "events-list"}
                      onChange={() => setDestinationType("events-list")}
                      className="sr-only"
                    />
                    <Circle
                      className={`w-4 h-4 ${
                        destinationType === "events-list"
                          ? "text-primary fill-primary"
                          : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">Events List</div>
                    <div className="text-xs text-muted-foreground">
                      Redirect to filtered events list
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-3 border border-border rounded-xl cursor-pointer hover:bg-muted">
                  <div className="relative">
                    <input
                      type="radio"
                      name="destinationType"
                      value="custom-url"
                      checked={destinationType === "custom-url"}
                      onChange={() => setDestinationType("custom-url")}
                      className="sr-only"
                    />
                    <Circle
                      className={`w-4 h-4 ${
                        destinationType === "custom-url"
                          ? "text-primary fill-primary"
                          : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">Custom URL</div>
                    <div className="text-xs text-muted-foreground">
                      Redirect to any external URL
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Destination Configuration */}
            {destinationType === "event" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Select Event <span className="text-red-500">*</span>
                </label>
                <Select
                  value={selectedEventId?.toString() || undefined}
                  onValueChange={(value) => setSelectedEventId(parseInt(value))}
                >
                  <SelectTrigger className={errors.event ? "border-red-500" : ""}>
                    <SelectValue placeholder="Choose an event" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((event) => (
                      <SelectItem key={event.id} value={event.id.toString()}>
                        {event.title} - {event.date}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.event && (
                  <p className="text-xs text-red-500">{errors.event}</p>
                )}
              </div>
            )}

            {destinationType === "events-list" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Filter Events (Optional)
                </label>
                <p className="text-xs text-muted-foreground">
                  Users will see a filtered list of events. Leave empty to show all events.
                </p>
                <div className="p-4 border border-border rounded-xl bg-muted/50">
                  <p className="text-xs text-muted-foreground">
                    Advanced filtering will be available in a future update. For now, all events will be shown.
                  </p>
                </div>
              </div>
            )}

            {destinationType === "custom-url" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  URL <span className="text-red-500">*</span>
                </label>
                <Input
                  type="url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://example.com"
                  className={errors.url ? "border-red-500" : ""}
                />
                {errors.url && (
                  <p className="text-xs text-red-500">{errors.url}</p>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerate}>Generate QR Code</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="w-5 h-5" />
              <span className="font-medium">QR Code Generated Successfully!</span>
            </div>

            <div className="flex flex-col items-center gap-4 p-6 border border-border rounded-xl bg-muted/50">
              <div className="p-4 bg-white rounded-lg">
                <QRCodeSVG value={qrUrl} size={256} />
              </div>
              <div className="text-center">
                <p className="font-medium text-sm mb-1">{name}</p>
                <p className="text-xs text-muted-foreground break-all">{qrUrl}</p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              <Button onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download QR Code
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
