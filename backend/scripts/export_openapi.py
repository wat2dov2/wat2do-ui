"""Export the FastAPI OpenAPI schema to a JSON file.

Usage:
    cd backend && .venv/bin/python scripts/export_openapi.py
    # writes ../frontend/src/shared/generated/openapi.json
"""

import json
import sys
from pathlib import Path

# Ensure the backend package root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app  # noqa: E402

OUTPUT = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "shared" / "generated" / "openapi.json"


def main() -> None:
    schema = app.openapi()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(schema, indent=2) + "\n")
    print(f"OpenAPI schema written to {OUTPUT}")


if __name__ == "__main__":
    main()
