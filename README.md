# wat2do-v2

## Frontend startup

```bash
cd frontend
npm install
npm run dev
```

## Backend startup

### macOS/Linux

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app --reload
```

### Windows (PowerShell)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --reload
```

## Integrations setup

See `INTEGRATIONS_README.md` for OAuth secret acquisition and integration environment setup.
