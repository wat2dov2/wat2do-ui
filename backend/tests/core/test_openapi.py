"""Tests for OpenAPI docs visibility based on environment setting."""

from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_docs_available_in_development(client):
    """In development (default), /docs, /redoc, and /openapi.json are accessible."""
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_docs_disabled_in_production():
    """When is_production is True, /docs, /redoc, and /openapi.json return 404.

    Constructs a standalone FastAPI app with the same conditional logic as
    main.py to verify the production path without mutating the shared
    settings singleton.
    """
    is_production = True  # simulates settings.is_production == True

    app = FastAPI(
        title="wat2do API",
        docs_url=None if is_production else "/docs",
        redoc_url=None if is_production else "/redoc",
        openapi_url=None if is_production else "/openapi.json",
    )

    @app.get("/health")
    def health():
        return {"status": "ok"}

    prod_client = TestClient(app)

    # Docs endpoints should be disabled
    assert prod_client.get("/docs").status_code == 404
    assert prod_client.get("/redoc").status_code == 404
    assert prod_client.get("/openapi.json").status_code == 404

    # App still works
    assert prod_client.get("/health").status_code == 200


def test_is_production_property():
    """The is_production property correctly reflects the environment field."""
    from core.config import Settings

    dev = Settings(
        environment="development",
        supabase_url="http://localhost",
        supabase_key="key",
    )
    assert dev.is_production is False

    prod = Settings(
        environment="production",
        supabase_url="http://localhost",
        supabase_key="key",
    )
    assert prod.is_production is True

    # Case-insensitive
    prod_upper = Settings(
        environment="Production",
        supabase_url="http://localhost",
        supabase_key="key",
    )
    assert prod_upper.is_production is True
