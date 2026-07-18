"use client";

import { type ChangeEvent, type DragEvent, useRef } from "react";
import { COMMONS_BADGE_COLORS } from "@/components/commons-poster";
import { PosterCopyFields, StudioField } from "@/components/poster-copy-fields";
import type { CommonsPost } from "@/lib/post";
import { MAX_RAW_EVENT_INFO_CHARACTERS } from "@/lib/prompt";

interface StudioControlsProps {
  post: CommonsPost;
  rawEventInfo: string;
  badgeColor: string;
  photoUrl: string | null;
  darkMode: boolean;
  spotlight: boolean;
  isGenerating: boolean;
  message: string;
  onPostChange: (post: CommonsPost) => void;
  onRawEventInfoChange: (value: string) => void;
  onBadgeColorChange: (value: string) => void;
  onPhotoSelect: (file: File | undefined) => void;
  onDarkModeChange: (enabled: boolean) => void;
  onSpotlightChange: (enabled: boolean) => void;
  onGenerate: () => void;
}

export function StudioControls({
  post,
  rawEventInfo,
  badgeColor,
  photoUrl,
  darkMode,
  spotlight,
  isGenerating,
  message,
  onPostChange,
  onRawEventInfoChange,
  onBadgeColorChange,
  onPhotoSelect,
  onDarkModeChange,
  onSpotlightChange,
  onGenerate,
}: StudioControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onPhotoSelect(file);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onPhotoSelect(event.dataTransfer.files[0]);
  };

  return (
    <aside className="controls-panel" aria-label="Post generator controls">
      <div className="control-heading">
        <p className="eyebrow">WATERLOO COMMONS STUDIO</p>
        <h1>Make the next post.</h1>
        <p>Generate a first draft, then edit every field here while the asset stays read-only.</p>
      </div>

      {message && <p className="status-message" role="status">{message}</p>}

      <section className="studio-section" aria-labelledby="studio-source-heading">
        <p className="eyebrow" id="studio-source-heading">01 / SOURCE DESCRIPTION</p>
        <StudioField
          label="Event description and details"
          value={rawEventInfo}
          multiline
          rows={7}
          maxLength={MAX_RAW_EVENT_INFO_CHARACTERS}
          placeholder="Paste a Wat2Do event, form response, or event description..."
          onChange={onRawEventInfoChange}
        />
        <button className="generate-button" type="button" onClick={onGenerate} disabled={isGenerating}>
          {isGenerating ? "GENERATING..." : "GENERATE POST"}
        </button>
      </section>

      <section className="studio-section" aria-labelledby="studio-copy-heading">
        <p className="eyebrow" id="studio-copy-heading">02 / POSTER COPY</p>
        <PosterCopyFields post={post} onChange={onPostChange} />
      </section>

      <section className="studio-section" aria-labelledby="studio-treatment-heading">
        <p className="eyebrow" id="studio-treatment-heading">03 / TREATMENT</p>
        <div className="studio-toggle-list">
          <StudioToggle
            label="Spotlight badge"
            description="Adds the pastel Spotlight chip before the category."
            checked={spotlight}
            onChange={onSpotlightChange}
          />
          <StudioToggle
            label="Dark poster"
            description="Switches the poster, masks, copy, and footer to black."
            checked={darkMode}
            onChange={onDarkModeChange}
          />
        </div>

        <div className="studio-colour-control">
          <p className="field-label">Category colour</p>
          <div className="colour-options" role="radiogroup" aria-label="Category colour">
            {COMMONS_BADGE_COLORS.map((colour) => (
              <button
                key={colour.value}
                className={badgeColor === colour.value ? "colour-option is-active" : "colour-option"}
                type="button"
                style={{ backgroundColor: colour.value }}
                aria-label={colour.name}
                aria-checked={badgeColor === colour.value}
                role="radio"
                onClick={() => onBadgeColorChange(colour.value)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="studio-section" aria-labelledby="studio-photo-heading">
        <p className="eyebrow" id="studio-photo-heading">04 / PHOTO</p>
        <button
          className="upload-dropzone"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <span>+</span>
          <strong>{photoUrl ? "REPLACE PHOTO" : "DROP PHOTO HERE"}</strong>
          <small>or browse files</small>
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />
      </section>

    </aside>
  );
}

function StudioToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="studio-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="studio-toggle-track" aria-hidden="true"><span /></span>
      <span className="studio-toggle-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
