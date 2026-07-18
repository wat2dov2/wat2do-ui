"use client";

import {
  COMMONS_POST_FIELD_LIMITS,
  MAX_COMMONS_POST_PILLS,
  type CommonsPost,
} from "@/lib/post";

interface PosterCopyFieldsProps {
  post: CommonsPost;
  onChange: (post: CommonsPost) => void;
}

export function PosterCopyFields({ post, onChange }: PosterCopyFieldsProps) {
  const updateField = (field: Exclude<keyof CommonsPost, "pills">, value: string) => {
    onChange({ ...post, [field]: value });
  };

  const updateTag = (index: number, value: string) => {
    const pills = Array.from(
      { length: MAX_COMMONS_POST_PILLS },
      (_, pillIndex) => post.pills[pillIndex] ?? "",
    );
    pills[index] = value;
    onChange({ ...post, pills });
  };

  return (
    <div className="studio-fields">
      <StudioField
        label="Event title"
        value={post.title}
        multiline
        rows={2}
        maxLength={COMMONS_POST_FIELD_LIMITS.title}
        hint="Use a line break when it improves the composition."
        onChange={(value) => updateField("title", value)}
      />
      <div className="studio-field-grid">
        <StudioField
          label="Hosted by"
          value={post.hostOrg}
          maxLength={COMMONS_POST_FIELD_LIMITS.hostOrg}
          onChange={(value) => updateField("hostOrg", value)}
        />
        <StudioField
          label="Category badge"
          value={post.badge}
          maxLength={COMMONS_POST_FIELD_LIMITS.badge}
          placeholder="VIBE"
          onChange={(value) => updateField("badge", value)}
        />
      </div>

      <fieldset className="studio-tags">
        <legend>Tags</legend>
        <p>Leave a field empty to remove it. Up to five tags appear on the asset.</p>
        <div className="studio-tag-grid">
          {Array.from({ length: MAX_COMMONS_POST_PILLS }, (_, index) => (
            <label className="studio-tag-field" key={index}>
              <span>Tag {index + 1}</span>
              <input
                value={post.pills[index] ?? ""}
                maxLength={COMMONS_POST_FIELD_LIMITS.pill}
                placeholder={`TAG ${index + 1}`}
                onChange={(event) => updateTag(index, event.target.value)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <StudioField
        label="Location"
        value={post.venue}
        maxLength={COMMONS_POST_FIELD_LIMITS.venue}
        onChange={(value) => updateField("venue", value)}
      />
      <div className="studio-field-grid">
        <StudioField
          label="Date"
          value={post.dateLine}
          maxLength={COMMONS_POST_FIELD_LIMITS.dateLine}
          onChange={(value) => updateField("dateLine", value)}
        />
        <StudioField
          label="Time"
          value={post.timeLine}
          maxLength={COMMONS_POST_FIELD_LIMITS.timeLine}
          onChange={(value) => updateField("timeLine", value)}
        />
      </div>
      <StudioField
        label="Caption / description"
        value={post.caption}
        multiline
        rows={8}
        maxLength={COMMONS_POST_FIELD_LIMITS.caption}
        hint="This is the published caption and longer descriptive copy."
        onChange={(value) => updateField("caption", value)}
      />
    </div>
  );
}

export function StudioField({
  label,
  value,
  hint,
  placeholder,
  multiline = false,
  rows = 1,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
