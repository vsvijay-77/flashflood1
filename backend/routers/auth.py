import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
import jwt

from lib.auth import (
    ACCESS_TOKEN_EXPIRE_HOURS,
    JWT_ALGORITHM,
    JWT_SECRET,
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_access_token,
    create_refresh_token,
    current_user,
    hash_password,
    verify_password,
)
from lib.db import db, supabase

router = APIRouter(prefix="/auth", tags=["auth"])

DESIGNATION_ROLE_MAP = {
    "Administrator": "admin",
    "Government Official": "gov_officer",
    "Disaster Management Officer": "gov_officer",
    "Forest Officer": "field_officer",
    "Environmental Officer": "field_officer",
}


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    phone: Optional[str] = ""
    organization: Optional[str] = ""
    designation: Optional[str] = "Environmental Officer"
    state: Optional[str] = ""
    district: Optional[str] = ""
    confirm_password: Optional[str] = None


@router.post("/login")
async def login(req: LoginRequest, response: Response):
    user = await db.users.find_one({"email": req.email.strip().lower()})
    if not user:
        # Fallback case-insensitive check
        user = await db.users.find_one({"email": {"$regex": f"^{req.email.strip()}$", "$options": "i"}})

    if not user or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended.")

    if user.get("status") == "pending":
        raise HTTPException(
            status_code=403,
            detail="Account pending verification by administrator. Please contact your system administrator.",
        )

    token_data = {
        "sub": user["id"],
        "email": user["email"],
        "role": user.get("role", "viewer"),
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    response.set_cookie(
        key="ein_session",
        value=access_token,
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        key="ein_refresh",
        value=refresh_token,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        samesite="lax",
    )

    clean_user = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return clean_user


class SupabaseSessionRequest(BaseModel):
    access_token: str


@router.post("/supabase-session")
async def supabase_session(req: SupabaseSessionRequest, response: Response):
    """Exchanges a Supabase Auth access token (from OAuth login) for an application session."""
    token = req.access_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Supabase access token is required.")

    try:
        auth_resp = supabase.auth.get_user(token)
        sb_user = auth_resp.user if auth_resp else None
        if not sb_user or not sb_user.email:
            raise HTTPException(status_code=401, detail="Invalid Supabase auth token.")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Supabase verification failed: {exc}")

    email = sb_user.email.strip().lower()
    user = await db.users.find_one({"email": email})

    if not user:
        # Create user record in our users table for OAuth sign-in
        meta = sb_user.user_metadata or {}
        full_name = meta.get("full_name") or meta.get("name") or ""
        name_parts = full_name.split() if full_name else []
        first_name = meta.get("first_name") or (name_parts[0] if name_parts else email.split("@")[0].capitalize())
        last_name = meta.get("last_name") or (" ".join(name_parts[1:]) if len(name_parts) > 1 else "Officer")
        role = meta.get("role") or "gov_officer"

        user = {
            "id": str(uuid.uuid4()),
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "phone": meta.get("phone", ""),
            "organization": meta.get("organization", "Emergency Response / Environmental Agency"),
            "designation": meta.get("designation", "Government Official"),
            "role": role,
            "state": meta.get("state", "Delhi"),
            "district": meta.get("district", "National HQ"),
            "status": "active",
            "verified": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)

    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended.")

    token_data = {
        "sub": user["id"],
        "email": user["email"],
        "role": user.get("role", "viewer"),
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    response.set_cookie(
        key="ein_session",
        value=access_token,
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        key="ein_refresh",
        value=refresh_token,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        samesite="lax",
    )

    clean_user = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return clean_user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("ein_refresh")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        raise HTTPException(status_code=401, detail="No refresh token provided.")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        email = payload.get("email")

        user = None
        if user_id:
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user and email:
            user = await db.users.find_one({"email": email}, {"_id": 0})

        if not user or user.get("status") != "active":
            raise HTTPException(status_code=401, detail="Session expired or invalid.")

        token_data = {
            "sub": user["id"],
            "email": user["email"],
            "role": user.get("role", "viewer"),
        }
        new_access = create_access_token(token_data)
        new_refresh = create_refresh_token(token_data)

        response.set_cookie(
            key="ein_session",
            value=new_access,
            max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
            httponly=True,
            samesite="lax",
        )
        response.set_cookie(
            key="ein_refresh",
            value=new_refresh,
            max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            httponly=True,
            samesite="lax",
        )
        return {"message": "Session refreshed", "ok": True}
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token.")


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("ein_session")
    response.delete_cookie("ein_refresh")
    return {"message": "Signed out successfully"}


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    clean_user = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return clean_user


@router.post("/register")
async def register(req: RegisterRequest):
    email = req.email.strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists. Please log in instead.")

    role = DESIGNATION_ROLE_MAP.get(req.designation, "viewer")
    user_id = str(uuid.uuid4())

    user_doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(req.password),
        "first_name": req.first_name.strip(),
        "last_name": req.last_name.strip(),
        "phone": req.phone or "",
        "organization": req.organization or "",
        "designation": req.designation or "Environmental Officer",
        "role": role,
        "state": req.state or "",
        "district": req.district or "",
        "status": "pending",
        "verified": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.users.insert_one(user_doc)

    # Optional sync to Supabase auth in background
    try:
        supabase.auth.admin.create_user({
            "email": email,
            "password": req.password,
            "email_confirm": True,
            "user_metadata": {
                "first_name": req.first_name,
                "last_name": req.last_name,
                "role": role,
                "status": "pending",
            },
        })
    except Exception:
        pass

    return {
        "message": "Account Registration Successful. Awaiting administrator verification.",
        "requires_verification": True,
        "user": {
            "id": user_id,
            "email": email,
            "status": "pending",
            "role": role,
        },
    }
