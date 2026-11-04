# Start Frontend
```bash
cd frontend && next start
```

# Start Backend
```bash
cd backend && source .venv/bin/activate && ../rust/target/debug/wat2do-api serve --reload
```

Build it first with `cd rust && cargo build --bin wat2do-api`; it serves port 8000 and runs uvicorn behind it (`docs/rust_api.md`).

## Signing in

Sign in with a login code sent to your email; see "Local development" in `README.md` for the email setup.
