# Start Frontend
```bash
cd frontend && npm run dev
```

# Start Backend
```bash
cd backend && source .venv/bin/activate && uvicorn main:app --reload
```

## Mock User Credentials (Supabase Auth)

### 1. Mock UWaterloo Student User
* **Email:** `student@uwaterloo.ca`
* **Password:** `Password123!`
* **Role:** `user`
* **School:** `University of Waterloo`
* **Faculty:** `Mathematics`

### 2. Mock Admin User
* **Email:** `admin@uwaterloo.ca`
* **Password:** `Password123!`
* **Role:** `admin`
* **School:** `University of Waterloo`
* **Faculty:** `Engineering`
