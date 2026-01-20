import React, { useState, useEffect } from "react";
import { X, Users, Tag, Link, Instagram, MessageCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { Club } from "@/types";

interface AddClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (club: Club) => void;
  initialData?: Club;
}

export function AddClubModal({
  isOpen,
  onClose,
  onSave,
  initialData,
}: AddClubModalProps) {
  const isEditMode = !!initialData;

  const [formData, setFormData] = useState({
    club_name: "",
    categories: [] as string[],
    club_page: "",
    ig: "",
    discord: "",
    club_type: "WUSA",
  });

  const [categoryInput, setCategoryInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pre-fill form if editing
  useEffect(() => {
    if (isEditMode && initialData) {
      setFormData({
        club_name: initialData.club_name,
        categories: initialData.categories,
        club_page: initialData.club_page,
        ig: initialData.ig || "",
        discord: initialData.discord || "",
        club_type: initialData.club_type,
      });
    } else {
      setFormData({
        club_name: "",
        categories: [],
        club_page: "",
        ig: "",
        discord: "",
        club_type: "WUSA",
      });
    }
    setCategoryInput("");
    setErrors({});
  }, [isOpen, isEditMode, initialData]);

  const addCategory = () => {
    if (categoryInput.trim() && !formData.categories.includes(categoryInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        categories: [...prev.categories, categoryInput.trim()],
      }));
      setCategoryInput("");
    }
  };

  const removeCategory = (category: string) => {
    setFormData((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c !== category),
    }));
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.club_name.trim()) {
      newErrors.club_name = "Club name is required";
    }

    if (formData.categories.length === 0) {
      newErrors.categories = "At least one category is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const club: Club = {
      id: initialData?.id || Date.now(),
      club_name: formData.club_name.trim(),
      categories: formData.categories,
      club_page: formData.club_page.trim(),
      ig: formData.ig.trim() || null,
      discord: formData.discord.trim() || null,
      club_type: formData.club_type,
    };

    onSave(club);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Club" : "Add Club"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update the club information below"
              : "Fill in the details to add a new club"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Club Name */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Club Name <span className="text-error">*</span>
            </label>
            <Input
              type="text"
              value={formData.club_name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, club_name: e.target.value }))
              }
              placeholder="e.g., Computer Science Club"
              className={errors.club_name ? "border-error" : ""}
            />
            {errors.club_name && (
              <p className="text-xs text-error mt-1">{errors.club_name}</p>
            )}
          </div>

          {/* Categories */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Categories <span className="text-error">*</span>
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCategory();
                  }
                }}
                placeholder="Add category..."
                className={errors.categories ? "border-error" : ""}
              />
              <Button type="button" onClick={addCategory}>
                Add
              </Button>
            </div>
            {formData.categories.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.categories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 bg-primary/20 text-primary text-xs px-2 py-1 rounded-full"
                  >
                    {cat}
                    <button
                      type="button"
                      onClick={() => removeCategory(cat)}
                      className="hover:bg-primary/30 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {errors.categories && (
              <p className="text-xs text-error mt-1">{errors.categories}</p>
            )}
          </div>

          {/* Club Type */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Club Type
            </label>
            <select
              value={formData.club_type}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, club_type: e.target.value }))
              }
              className="w-full px-3 py-2 border border-border rounded-lg bg-muted text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="WUSA">WUSA</option>
              <option value="Independent">Independent</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Club Page URL */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Club Page URL
            </label>
            <Input
              type="text"
              value={formData.club_page}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, club_page: e.target.value }))
              }
              placeholder="e.g., https://example.com or 123"
            />
          </div>

          {/* Instagram */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Instagram Handle
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                @
              </span>
              <Input
                type="text"
                value={formData.ig}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, ig: e.target.value }))
                }
                placeholder="username"
                className="pl-7"
              />
            </div>
          </div>

          {/* Discord */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Discord Link
            </label>
            <Input
              type="text"
              value={formData.discord}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, discord: e.target.value }))
              }
              placeholder="https://discord.gg/..."
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {isEditMode ? "Update Club" : "Add Club"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
