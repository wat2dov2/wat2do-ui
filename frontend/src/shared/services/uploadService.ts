import { getAccessToken } from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";

const BASE_URL = API_BASE_URL;

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

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers,
    body: form,
  });

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

export async function uploadAvatar(file: File): Promise<string> {
  return uploadFile("/uploads/avatar", file);
}

export async function uploadClubLogo(clubId: number, file: File): Promise<string> {
  return uploadFile(`/uploads/club-logo/${clubId}`, file);
}

export async function uploadQRAsset(file: File): Promise<string> {
  return uploadFile("/uploads/qr-asset", file);
}
