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

interface UploadErrorResponse {
  detail?: string;
}

function createUploadRequest(
  file: File,
  authentication: "session" | "none",
): RequestInit {
  const form = new FormData();
  form.append("file", file);

  const headers: Record<string, string> = {};
  if (authentication === "session") {
    const token = getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  return {
    method: "POST",
    headers,
    body: form,
  };
}

async function getUploadErrorMessage(
  response: Response,
  failureLabel: string,
): Promise<string> {
  const body: UploadErrorResponse = await response.json().catch((err) => {
    console.error("Failed to parse file upload error response:", err);
    return {};
  });
  return body.detail || `${failureLabel} failed (${response.status})`;
}

async function requestFileUpload<T>(
  endpoint: string,
  file: File,
  failureLabel: string,
  authentication: "session" | "none" = "session",
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  let response = await fetch(url, createUploadRequest(file, authentication));

  if (response.status === 401 && authentication === "session") {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await fetch(url, createUploadRequest(file, authentication));
    } else {
      handleAuthFailure();
      throw new Error(`${failureLabel} failed: session expired`);
    }
  }

  if (!response.ok) {
    throw new Error(await getUploadErrorMessage(response, failureLabel));
  }

  return response.json() as Promise<T>;
}

async function uploadFile(endpoint: string, file: File): Promise<string> {
  const data = await requestFileUpload<UploadResponse>(endpoint, file, "Upload");
  return data.url;
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
  return requestFileUpload<EventFormData>(
    "/ai/parse-event-image",
    file,
    "AI parsing",
    "none",
  );
}
