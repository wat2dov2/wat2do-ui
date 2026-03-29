---
name: endpoint-generator
description: Use this when the user asks to "create an endpoint," "add a CRUD slice," "add a new resource," "wire up a new feature end-to-end," or "full-stack slice." Generates all 6 files across backend and frontend.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Endpoint Generator — Full-Stack Slice

You are creating a complete CRUD endpoint across the full stack. This requires exactly 6 files (plus registration).

## File Checklist

For a resource called `[resource]` (e.g., "announcement"):

### Backend (4 files)
1. `backend/schemas/[resource].py` — Pydantic models
2. `backend/services/[resource]_service.py` — Supabase queries
3. `backend/routers/[resource].py` — FastAPI route handlers
4. `backend/main.py` — Register the router (edit)

### Frontend (2+ files)
5. `frontend/src/features/[resource]/api/[resource].api.ts` — API functions
6. `frontend/src/shared/types/[resource].types.ts` — TypeScript interfaces

## Backend Templates

### Schema (`backend/schemas/[resource].py`)
```python
from pydantic import BaseModel

class [Resource]Create(BaseModel):
    title: str
    description: str | None = None

class [Resource]Update(BaseModel):
    title: str | None = None
    description: str | None = None

class [Resource]Response(BaseModel):
    id: int
    title: str
    description: str | None = None
    created_at: str

    model_config = {"from_attributes": True}
```
- `Create`: required fields have no default, optional use `| None = None`
- `Update`: ALL fields optional for PATCH support
- `Response`: includes `id` + timestamps, ends with `model_config`

### Service (`backend/services/[resource]_service.py`)
```python
from core.database import get_sb
from schemas.[resource] import [Resource]Create, [Resource]Update

def get_[resource](resource_id: int) -> dict | None:
    r = get_sb().table("[resources]").select("*").eq("id", resource_id).execute()
    return r.data[0] if r.data else None

def list_[resources](skip: int = 0, limit: int = 100) -> list[dict]:
    r = get_sb().table("[resources]").select("*").order("created_at", desc=True).range(skip, skip + limit - 1).execute()
    return r.data or []

def create_[resource](data: [Resource]Create) -> dict:
    return get_sb().table("[resources]").insert(data.model_dump()).execute().data[0]

def update_[resource](resource_id: int, data: [Resource]Update) -> dict | None:
    if get_[resource](resource_id) is None:
        return None
    r = get_sb().table("[resources]").update(data.model_dump(exclude_unset=True)).eq("id", resource_id).execute()
    return r.data[0] if r.data else None

def delete_[resource](resource_id: int) -> bool:
    r = get_sb().table("[resources]").delete().eq("id", resource_id).execute()
    return bool(r.data)
```
- All functions are **sync** (not async)
- Use `get_sb()` which returns admin Supabase client if available
- Use `model_dump(exclude_unset=True)` for PATCH updates
- Return `None` for not-found, let router handle HTTP errors

### Router (`backend/routers/[resource].py`)
```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from core.auth import get_current_user
from schemas.[resource] import [Resource]Create, [Resource]Update, [Resource]Response
from services import [resource]_service

router = APIRouter(prefix="/[resources]", tags=["[resources]"])

@router.get("/", response_model=list[[Resource]Response])
def list_[resources](skip: int = 0, limit: int = Query(default=100, le=500)):
    return [resource]_service.list_[resources](skip=skip, limit=limit)

@router.get("/{resource_id}", response_model=[Resource]Response)
def get_[resource](resource_id: int):
    item = [resource]_service.get_[resource](resource_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="[Resource] not found")
    return item

@router.post("/", response_model=[Resource]Response, status_code=status.HTTP_201_CREATED)
def create_[resource](data: [Resource]Create, _=Depends(get_current_user)):
    return [resource]_service.create_[resource](data)

@router.patch("/{resource_id}", response_model=[Resource]Response)
def update_[resource](resource_id: int, data: [Resource]Update, _=Depends(get_current_user)):
    item = [resource]_service.update_[resource](resource_id, data)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="[Resource] not found")
    return item

@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_[resource](resource_id: int, _=Depends(get_current_user)):
    if not [resource]_service.delete_[resource](resource_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="[Resource] not found")
```
- Auth: `_=Depends(get_current_user)` — underscore because the user dict is unused
- Public reads (GET), protected writes (POST/PATCH/DELETE)
- 201 for create, 204 for delete

### Registration (`backend/main.py`)
Add two lines:
```python
from routers import [resource]
app.include_router([resource].router)
```

## Frontend Templates

### Types (`frontend/src/shared/types/[resource].types.ts`)
```typescript
export interface [Resource] {
  id: number;
  title: string;
  description: string | null;
  created_at: string;
}

export interface [Resource]FormData {
  title: string;
  description: string;
}
```

### API (`frontend/src/features/[resource]/api/[resource].api.ts`)
```typescript
import { api } from "@/shared/services/apiClient";
import type { [Resource], [Resource]FormData } from "@/shared/types/[resource].types";

export async function fetchAll[Resources](): Promise<[Resource][]> {
  return api.get<[Resource][]>("/[resources]/");
}

export async function create[Resource](data: [Resource]FormData): Promise<[Resource]> {
  return api.post<[Resource]>("/[resources]/", data);
}

export async function update[Resource](id: number, data: Partial<[Resource]FormData>): Promise<[Resource]> {
  return api.patch<[Resource]>(`/[resources]/${id}`, data);
}

export async function delete[Resource](id: number): Promise<void> {
  await api.delete(`/[resources]/${id}`);
}
```

## Constraints

- Never skip the service layer — routers must NOT query Supabase directly
- Never use async in backend services — Supabase SDK is sync in this project
- Never install new dependencies — this pattern uses only existing libraries
- Always register the router in `main.py` after creating the files
- Start immediately with the files — no preamble
