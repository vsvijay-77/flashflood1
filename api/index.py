"""
api/index.py — Vercel Python Serverless entry point.

Vercel looks for `app` in this file when the runtime is Python.
We import the FastAPI application from backend/server.py and re-export it.

Import path resolution:
  Vercel adds the project root to sys.path, so `backend.server` resolves to
  <project_root>/backend/server.py which contains the `app` FastAPI instance.
"""
import sys
import os
from pathlib import Path

# Ensure project root is on sys.path so `backend.*` and `routers.*` imports work
ROOT = Path(__file__).parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Also add backend/ so relative imports inside backend (lib, routers, services) work
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Load .env if present (local dev only; Vercel uses dashboard env vars)
try:
    from dotenv import load_dotenv
    env_file = ROOT / "backend" / ".env"
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    pass

# Import the FastAPI app — Vercel serves this as a serverless function
from backend.server import app  # noqa: E402

# `app` is the ASGI application Vercel will call for every /api/* request.
# Do NOT call uvicorn.run() here — Vercel manages the server lifecycle.
