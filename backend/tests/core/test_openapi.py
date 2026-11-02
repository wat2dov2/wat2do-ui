"""Tests for OpenAPI docs visibility based on environment setting."""

import pytest
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
        data_api_url="http://localhost",
        data_api_key="key",
    )
    assert dev.is_production is False

    prod = Settings(
        environment="production",
        data_api_url="http://localhost",
        data_api_key="key",
    )
    assert prod.is_production is True

    # Case-insensitive
    prod_upper = Settings(
        environment="Production",
        data_api_url="http://localhost",
        data_api_key="key",
    )
    assert prod_upper.is_production is True


def test_schema_includes_rust_routes(client):
    """Routes served by the Rust server stay in the one OpenAPI schema."""
    schema = client.app.openapi()
    assert schema["paths"]["/health"]["get"]["operationId"] == "health_health_get"
    banner = schema["paths"]["/site-banner"]["get"]
    assert banner["operationId"] == "get_site_banner_endpoint_site_banner_get"
    assert "SiteBannerResponse" in schema["components"]["schemas"]
    assert "/events/" in schema["paths"]


def _schema(paths, schemas=None):
    return {
        "paths": {path: {"get": {}} for path in paths},
        "components": {"schemas": schemas or {}},
    }


def test_merge_refuses_routes_both_apps_would_serve():
    from core.openapi import merge_rust_routes

    for python_path, rust_path in [
        ("/site-banner", "/site-banner"),
        ("/site-banner/", "/site-banner"),
        ("/clubs", "/clubs/"),
        ("/clubs/{club_id}", "/clubs/{id}"),
        ("/clubs/featured", "/clubs/{id}"),
    ]:
        with pytest.raises(RuntimeError, match="would capture"):
            merge_rust_routes(_schema([python_path]), _schema([rust_path]))
    merged = merge_rust_routes(_schema(["/clubs/{club_id}/members"]), _schema(["/clubs/{id}"]))
    assert list(merged["paths"]) == ["/clubs/{club_id}/members", "/clubs/{id}"]


def test_merge_refuses_conflicting_schema_names():
    from core.openapi import merge_rust_routes

    shared = {"type": "object"}
    merged = merge_rust_routes(_schema([], {"A": shared}), _schema(["/a"], {"A": shared}))
    assert merged["components"]["schemas"] == {"A": shared}
    with pytest.raises(RuntimeError, match="defined differently"):
        merge_rust_routes(_schema([], {"A": shared}), _schema(["/a"], {"A": {"type": "string"}}))
