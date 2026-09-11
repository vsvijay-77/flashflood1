from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from lib.auth import current_user
from lib.db import supabase

router = APIRouter(prefix="/auth", tags=["auth"])

class RegisterRequest(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    phone: str
    organization: str
    designation: str
    state: str
    district: str

@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return user

@router.post("/register")
async def register(req: RegisterRequest):
    try:
        # Create user via Admin API to bypass rate limits!
        user = supabase.auth.admin.create_user({
            "email": req.email,
            "password": req.password,
            "email_confirm": True
        })
        
        # Insert profile
        supabase.table("user_profiles").insert({
            "id": user.user.id,
            "first_name": req.first_name,
            "last_name": req.last_name,
            "phone": req.phone,
            "organization": req.organization,
            "designation": req.designation,
            "role": "admin",
            "state": req.state,
            "district": req.district
        }).execute()
        
        return {
            "message": "Account Registration Successful",
            "requires_verification": False,
            "user": {"id": user.user.id}
        }
    except Exception as e:
        msg = str(e)
        if "already been registered" in msg or "already registered" in msg:
            raise HTTPException(status_code=400, detail="An account with this email already exists. Please log in instead.")
        print("Register Error:", e)
        raise HTTPException(status_code=400, detail="Registration failed. Please try again.")
