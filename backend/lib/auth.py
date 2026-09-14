import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, Request
import jwt
import httpx
from lib.db import db

ROLES = ["admin", "gov_officer", "field_officer", "viewer"]
JWT_SECRET = os.environ.get("JWT_SECRET", "ein_secret_jwt_key_flash_flood_production_2026_secure")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8
REFRESH_TOKEN_EXPIRE_DAYS = 30


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hash_hex = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"pbkdf2_sha256${salt}${hash_hex}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        parts = password_hash.split("$")
        if len(parts) != 3 or parts[0] != "pbkdf2_sha256":
            return False
        salt, expected_hash = parts[1], parts[2]
        calc_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
        return hmac.compare_digest(calc_hash, expected_hash)
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(request: Request) -> dict:
    token = request.cookies.get("ein_session")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # 1. Try local JWT token verification
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        email = payload.get("email")

        user = None
        if user_id:
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user and email:
            user = await db.users.find_one({"email": email}, {"_id": 0})

        if user:
            if user.get("status") == "suspended":
                raise HTTPException(status_code=403, detail="Account suspended.")
            if user.get("status") == "pending":
                raise HTTPException(status_code=403, detail="Account pending verification by administrator.")
            return user
        elif user_id or email:
            return {
                "id": user_id or "user-jwt",
                "email": email or "",
                "role": payload.get("role", "admin"),
                "status": "active",
                "first_name": payload.get("first_name", "Officer"),
                "last_name": payload.get("last_name", ""),
            }
    except jwt.PyJWTError:
        pass

    # 2. Fallback: Check Supabase Auth API
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    if supabase_url and supabase_key:
        try:
            url = f"{supabase_url}/auth/v1/user"
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {token}",
            }
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    user_data = res.json()
                    email = user_data.get("email")
                    user = await db.users.find_one({"email": email}, {"_id": 0})
                    if user:
                        return user
                    meta = user_data.get("user_metadata", {})
                    return {
                        "id": user_data["id"],
                        "email": email,
                        "first_name": meta.get("first_name", "Official"),
                        "last_name": meta.get("last_name", "User"),
                        "role": meta.get("role", "admin"),
                        "status": "active",
                    }
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Invalid or expired session token")


def require_roles(*allowed: str):
    async def guard(user: dict = Depends(current_user)) -> dict:
        if user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="You do not have permission to access this resource.")
        return user
    return guard
