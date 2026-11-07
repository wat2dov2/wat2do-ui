"""One OpenAPI schema for the whole API while routes move to Rust.

The Rust server (`rust/src/api`) serves the routes it has ported and proxies the
rest to this FastAPI app. Its routes' OpenAPI paths and schemas are committed in
``core/rust_openapi.json`` (``wat2do-api openapi``; a Rust test keeps the file
current), and ``app.openapi()`` returns FastAPI's schema with them merged in, so
type generation, ``/docs`` and the production profiler keep seeing every route.

Merging refuses a route served by both apps, a FastAPI path that a Rust route
would capture (including Starlette's trailing-slash redirect), and a schema
name defined differently on each side.
"""

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI

RUST_OPENAPI = Path(__file__).with_name("rust_openapi.json")


def rust_routes() -> dict[str, Any]:
    """The committed OpenAPI fragment of the Rust routes."""
    return json.loads(RUST_OPENAPI.read_text(encoding="utf-8"))


def _template_pattern(path: str) -> re.Pattern[str]:
    """Match the paths a Rust route template serves, in either trailing-slash form."""
    if path == "/":
        return re.compile("/")
    pattern = re.sub(r"\\\{[^}]*\\\}", "[^/]+", re.escape(path.rstrip("/")))
    return re.compile(f"{pattern}/?")


def _captured(python_path: str, rust_path: str) -> bool:
    concrete = re.sub(r"\{[^}]*\}", "x", python_path)
    return _template_pattern(rust_path).fullmatch(concrete) is not None


def merge_rust_routes(schema: dict[str, Any], rust: dict[str, Any]) -> dict[str, Any]:
    """Return *schema* with the Rust routes' paths, component schemas and security schemes added."""
    paths = dict(schema.get("paths", {}))
    for rust_path in rust["paths"]:
        captured = [path for path in paths if _captured(path, rust_path)]
        if captured:
            raise RuntimeError(
                f"Rust route {rust_path} would capture FastAPI routes {captured}; "
                "port the whole router and delete its Python routes"
            )
    paths.update(rust["paths"])
    components = dict(schema.get("components", {}))
    # The Rust routes' `security` entries name HTTPBearer, which FastAPI only
    # describes while one of its own routes needs a signed-in user.
    for section in ("schemas", "securitySchemes"):
        merged = dict(components.get(section, {}))
        for name, definition in rust.get("components", {}).get(section, {}).items():
            if name in merged and merged[name] != definition:
                raise RuntimeError(f"Schema {name} is defined differently by FastAPI and Rust")
            merged[name] = definition
        if merged:
            components[section] = merged
    return {**schema, "paths": paths, "components": components}


def install_rust_routes(app: FastAPI, rust: Callable[[], dict[str, Any]] = rust_routes) -> None:
    """Make ``app.openapi()`` describe the Rust routes too."""
    build = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = merge_rust_routes(build(), rust())
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]
