---
name: contract-sync
description: Use this when the user says "sync types," "update frontend models," "I changed the API schema," "backend types changed," or "contract mismatch." Reads Pydantic schemas and rewrites corresponding TypeScript interfaces.
allowed-tools: Read, Edit, Write, Glob, Grep
---

# Contract Sync — Pydantic → TypeScript

You are synchronizing backend Pydantic schemas with frontend TypeScript types after an API contract change.

## The Mapping

Backend schemas live in `backend/schemas/`. Frontend types live in multiple locations:

| Backend File | Frontend File(s) |
|---|---|
| `schemas/event.py` → `EventResponse` | `frontend/src/shared/types/event.types.ts` → `Event` |
| `schemas/event.py` → `EventCreate` | `frontend/src/shared/types/event.types.ts` → `EventFormData` |
| `schemas/user.py` → `UserResponse` | `frontend/src/features/auth/api/auth.api.ts` → `BackendUserProfile` |
| `schemas/user.py` → `UserResponse` (subset) | `frontend/src/features/auth/api/userRepository.ts` → `UserProfile` |
| `schemas/auth.py` → `TokenResponse` | `frontend/src/features/auth/api/auth.api.ts` → `TokenResponse` |
| `schemas/auth.py` → `SignupResponse` | `frontend/src/features/auth/api/auth.api.ts` → `SignupResponse` |
| `schemas/club.py` → `ClubResponse` | `frontend/src/shared/types/common.types.ts` → `Club` |
| `schemas/qr_code.py` → `QrCodeResponse` | `frontend/src/shared/types/qrcode.types.ts` → `QRCode` |
| `schemas/qr_code.py` → `QrCodeResponse` (raw) | `frontend/src/features/qrcode/api/qrcode.api.ts` → `QrCodePosterBackend` |
| `schemas/qr_code.py` → `QrCodeScanResponse` | `frontend/src/shared/types/qrcode.types.ts` → `QRCodeScan` |
| `schemas/qr_code.py` → `QrCodeScanResponse` (raw) | `frontend/src/features/qrcode/api/qrcode.api.ts` → `QrCodeScanBackend` |
| `schemas/qr_code.py` → `QrCodeRedirect` | `frontend/src/features/qrcode/api/qrcode.api.ts` → `QrRedirectConfig` |

## Steps

1. **Read the changed backend schema** — identify which fields were added, removed, or renamed
2. **Find ALL corresponding frontend types** using the mapping above. If unsure, grep for the backend field name across `frontend/src/`
3. **Update the TypeScript interface(s)** — apply the field change
4. **Check normalizer functions** — QR code types use `normalizeBackendPoster()` and `normalizeBackendScan()` in `qrcode.api.ts` that convert snake_case → camelCase. If fields changed, update these too
5. **Check API call sites** — grep for functions that send data TO the changed endpoint (create/update calls). Verify the payload object matches the new schema
6. **Check consumers** — grep for the TypeScript type name to find components that read the changed fields

## Naming Convention Rules

- Backend uses `snake_case` (e.g., `dtstart_utc`, `is_first_year`, `source_image_url`)
- Some frontend types keep snake_case to match backend directly (`BackendUserProfile`, `QrCodePosterBackend`)
- Other frontend types use camelCase (`QRCode.destinationType`, `UserProfile.isFirstYear`)
- Normalizer functions bridge the two — if both versions exist, update BOTH

## Legacy Field Warning

The `Event` type has dual-format fields for backward compatibility:
- `dtstart_utc` / `dtend_utc` (new ISO format) AND `date` / `time` (old format)
- `source_image_url` AND `imageUrl`
- `registration` AND `requiresRegistration`
- `added_at` AND `addedDate`

Do NOT remove legacy fields unless the user explicitly confirms migration is complete.

## Constraints

- Never change backend schemas — this skill only propagates backend changes TO the frontend
- Never remove legacy fields from the Event type without explicit confirmation
- Always check normalizer functions when updating QR code types
- Always grep for field usage after updating a type — TypeScript will catch type errors but not runtime access patterns
