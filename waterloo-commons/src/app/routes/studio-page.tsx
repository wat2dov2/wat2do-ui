"use client";

import { toPng } from "html-to-image";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommonsPoster, COMMONS_BADGE_COLORS } from "@/components/commons-poster";
import { SiteHeader } from "@/components/site-header";
import { StudioControls } from "@/components/studio-controls";
import { DEFAULT_POST, normalisePost, type CommonsPost } from "@/lib/post";

export default function StudioPage() {
  const [post, setPost] = useState<CommonsPost>(DEFAULT_POST);
  const [rawEventInfo, setRawEventInfo] = useState("");
  const [badgeColor, setBadgeColor] = useState(COMMONS_BADGE_COLORS[0].value);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [spotlight, setSpotlight] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const posterRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const setPhoto = useCallback((file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) {
      setMessage("Choose an image file for the poster background.");
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;
    setPhotoUrl(nextUrl);
    setMessage("");
  }, []);

  const generatePost = async () => {
    if (!rawEventInfo.trim()) {
      setMessage("Paste the event information first.");
      return;
    }

    setIsGenerating(true);
    setMessage("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawEventInfo }),
      });
      const result = (await response.json()) as { post?: CommonsPost; error?: string };

      if (!response.ok || !result.post) throw new Error(result.error ?? "Generation failed.");
      setPost(normalisePost(result.post));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Generation failed. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const exportPng = async () => {
    if (!posterRef.current) return;

    setIsExporting(true);
    setMessage("");
    try {
      const dataUrl = await toPng(posterRef.current, {
        canvasWidth: 1080,
        canvasHeight: 1350,
        cacheBust: true,
        pixelRatio: 1,
      });
      const link = document.createElement("a");
      link.download = "waterloo-commons-post.png";
      link.href = dataUrl;
      link.click();
    } catch {
      setMessage("The post could not be exported. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(post.caption);
      setMessage("Caption copied.");
    } catch {
      setMessage("Could not copy the caption. Select it manually in the Caption / description field.");
    }
  };

  return (
    <main className="generator-page">
      <SiteHeader audience="admin" />

      <section className="generator-layout">
        <StudioControls
          post={post}
          rawEventInfo={rawEventInfo}
          badgeColor={badgeColor}
          photoUrl={photoUrl}
          darkMode={darkMode}
          spotlight={spotlight}
          isGenerating={isGenerating}
          message={message}
          onPostChange={setPost}
          onRawEventInfoChange={setRawEventInfo}
          onBadgeColorChange={setBadgeColor}
          onPhotoSelect={setPhoto}
          onDarkModeChange={setDarkMode}
          onSpotlightChange={setSpotlight}
          onGenerate={generatePost}
        />

        <section className="preview-panel" aria-label="Waterloo Commons post preview">
          <div className="preview-heading">
            <p className="eyebrow">READ-ONLY PREVIEW</p>
            <p>Use the Studio controls to update this asset.</p>
          </div>

          <div className="poster-frame">
            <CommonsPoster
              ref={posterRef}
              post={post}
              photoUrl={photoUrl}
              badgeColor={badgeColor}
              darkMode={darkMode}
              spotlight={spotlight}
            />
          </div>

          <div className="export-actions">
            <button className="secondary-button" type="button" onClick={copyCaption}>COPY CAPTION</button>
            <button className="primary-button" type="button" onClick={exportPng} disabled={isExporting}>
              {isExporting ? "EXPORTING..." : "EXPORT PNG"}
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
