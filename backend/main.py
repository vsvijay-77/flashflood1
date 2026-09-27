"""
backend/main.py - Main entrypoint for FastAPI application.
Exposes `app` for Vercel and ASGI runners.
"""
from backend.server import app

__all__ = ["app"]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8001, reload=True)
