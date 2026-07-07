import {
  getAccessToken,
  refreshAccessToken,
  handleAuthFailure,
} from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";
import type { EventFormData } from "@/shared/types";

interface UploadResponse {
  url: string;
}

async function uploadFile(
  endpoint: string,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);

  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: form,
  });

  // On 401, attempt token refresh and retry the upload
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retryForm = new FormData();
      retryForm.append("file", file);

      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${getAccessToken()}`,
      };
      const retryRes = await fetch(url, {
        method: "POST",
        headers: retryHeaders,
        body: retryForm,
      });

      if (!retryRes.ok) {
        const body = await retryRes.json().catch((err) => { console.error("Failed to parse upload retry error response:", err); return {}; });
        throw new Error(body.detail || `Upload failed (${retryRes.status})`);
      }

      const data: UploadResponse = await retryRes.json();
      return data.url;
    }

    handleAuthFailure();
    throw new Error("Upload failed: session expired");
  }

  if (!res.ok) {
    const body = await res.json().catch((err) => { console.error("Failed to parse upload error response:", err); return {}; });
    throw new Error(body.detail || `Upload failed (${res.status})`);
  }

  const data: UploadResponse = await res.json();
  return data.url;
}

export async function uploadEventImage(eventId: number, file: File): Promise<string> {
  return uploadFile(`/uploads/event-image/${eventId}`, file);
}

export async function uploadEventImageUnsigned(file: File): Promise<string> {
  return uploadFile("/uploads/event-image", file);
}

export async function uploadAvatar(file: File): Promise<string> {
  return uploadFile("/uploads/avatar", file);
}

export async function uploadQRAsset(file: File): Promise<string> {
  return uploadFile("/uploads/qr-asset", file);
}

export async function uploadClaimProof(file: File): Promise<string> {
  return uploadFile("/uploads/claim-proof", file);
}

export async function parseEventImage(file: File): Promise<EventFormData> {
  const form = new FormData();
  form.append("file", file);

  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}/ai/parse-event-image`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: form,
  });

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retryForm = new FormData();
      retryForm.append("file", file);

      const retryHeaders: Record<string, string> = {
        Authorization: `Bearer ${getAccessToken()}`,
      };
      const retryRes = await fetch(url, {
        method: "POST",
        headers: retryHeaders,
        body: retryForm,
      });

      if (!retryRes.ok) {
        const body = await retryRes.json().catch((err) => { console.error("Failed to parse upload retry error response:", err); return {}; });
        throw new Error(body.detail || `AI parsing failed (${retryRes.status})`);
      }

      return await retryRes.json();
    }

    handleAuthFailure();
    throw new Error("AI parsing failed: session expired");
  }

  if (!res.ok) {
    const body = await res.json().catch((err) => { console.error("Failed to parse upload error response:", err); return {}; });
    throw new Error(body.detail || `AI parsing failed (${res.status})`);
  }

  return await res.json();
}
