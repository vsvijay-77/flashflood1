"""User administration, notifications and reports."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import ROLES, current_user, require_roles
from lib.db import db, supabase
from models.schemas import (
    MessageResponse,
    Notification,
    Report,
    ReportCreate,
    User,
    UserAdminUpdate,
)

router = APIRouter(tags=["admin"])


@router.get("/users", response_model=List[User])
async def list_users(user: dict = Depends(require_roles("admin"))):
    try:
        auth_users = supabase.auth.admin.list_users()
        profiles_res = supabase.table("user_profiles").select("*").execute()
        profiles_by_id = {p["id"]: p for p in (profiles_res.data or [])}

        users_list = []
        for u in auth_users:
            p = profiles_by_id.get(u.id, {})
            email = u.email or ""
            meta = getattr(u, "user_metadata", {}) or {}
            first_name = p.get("first_name") or meta.get("first_name") or (email.split("@")[0] if email else "Officer")
            last_name = p.get("last_name") or meta.get("last_name") or ""

            status = meta.get("status") or "active"
            if getattr(u, "banned_until", None):
                status = "suspended"

            users_list.append(
                User(
                    id=u.id,
                    email=email,
                    first_name=first_name,
                    last_name=last_name,
                    phone=p.get("phone") or meta.get("phone") or "",
                    organization=p.get("organization") or meta.get("organization") or "Department of Environmental Safety",
                    designation=p.get("designation") or meta.get("designation") or "Field Officer",
                    role=p.get("role") or meta.get("role") or "admin",
                    state=p.get("state") or meta.get("state") or "",
                    district=p.get("district") or meta.get("district") or "",
                    status=status,
                    verified=True,
                    created_at=u.created_at,
                )
            )
        return users_list
    except Exception as exc:
        print("Error listing users from Supabase:", exc)
        docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
        return [User(**d) for d in docs]


@router.patch("/users/{user_id}", response_model=User)
async def update_user(
    user_id: str, payload: UserAdminUpdate, user: dict = Depends(require_roles("admin"))
):
    changes = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "role" in changes and changes["role"] not in ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {list(ROLES)}")
    if "status" in changes:
        if changes["status"] not in ("pending", "active", "suspended"):
            raise HTTPException(status_code=422, detail="status must be pending, active or suspended")
        changes["verified"] = changes["status"] == "active"

    try:
        auth_user = supabase.auth.admin.get_user_by_id(user_id)
        if not auth_user or not auth_user.user:
            raise HTTPException(status_code=404, detail="User not found")

        u = auth_user.user
        meta = getattr(u, "user_metadata", {}) or {}

        if "status" in changes:
            meta["status"] = changes["status"]
            supabase.auth.admin.update_user_by_id(user_id, {"user_metadata": meta})

        if "role" in changes:
            meta["role"] = changes["role"]
            supabase.auth.admin.update_user_by_id(user_id, {"user_metadata": meta})
            supabase.table("user_profiles").upsert({
                "id": user_id,
                "role": changes["role"]
            }).execute()

        prof_res = supabase.table("user_profiles").select("*").eq("id", user_id).execute()
        prof = prof_res.data[0] if prof_res.data else {}

        email = u.email or ""
        first_name = prof.get("first_name") or meta.get("first_name") or (email.split("@")[0] if email else "Officer")
        last_name = prof.get("last_name") or meta.get("last_name") or ""

        return User(
            id=u.id,
            email=email,
            first_name=first_name,
            last_name=last_name,
            phone=prof.get("phone") or meta.get("phone") or "",
            organization=prof.get("organization") or meta.get("organization") or "Department of Environmental Safety",
            designation=prof.get("designation") or meta.get("designation") or "Field Officer",
            role=changes.get("role") or prof.get("role") or meta.get("role") or "admin",
            state=prof.get("state") or meta.get("state") or "",
            district=prof.get("district") or meta.get("district") or "",
            status=changes.get("status") or meta.get("status") or "active",
            verified=True,
            created_at=u.created_at,
        )
    except HTTPException:
        raise
    except Exception as exc:
        print("Error updating user in Supabase:", exc)
        result = await db.users.update_one({"id": user_id}, {"$set": changes})
        if result and result.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")
        return User(**doc)


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")
    try:
        supabase.auth.admin.delete_user(user_id)
        supabase.table("user_profiles").delete().eq("id", user_id).execute()
    except Exception as exc:
        print("Error deleting user in Supabase:", exc)
        await db.users.delete_one({"id": user_id})
    return MessageResponse(message="User account removed")


@router.get("/notifications", response_model=List[Notification])
async def list_notifications(user: dict = Depends(current_user)):
    docs = await db.notifications.find({}, {"_id": 0}).sort("created_at", -1).to_list(60)
    return [Notification(**d) for d in docs]


@router.post("/notifications/read-all", response_model=MessageResponse)
async def mark_all_read(user: dict = Depends(current_user)):
    await db.notifications.update_many({"read": False}, {"$set": {"read": True}})
    return MessageResponse(message="All notifications marked as read")


@router.get("/reports", response_model=List[Report])
async def list_reports(user: dict = Depends(current_user)):
    docs = await db.reports.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [Report(**d) for d in docs]


@router.post("/reports", response_model=Report, status_code=201)
async def create_report(
    payload: ReportCreate, user: dict = Depends(require_roles("admin", "gov_officer"))
):
    report = Report(**payload.model_dump(), status="ready", size_kb=180 + len(payload.title) * 7)
    await db.reports.insert_one(report.model_dump())
    await db.notifications.insert_one(
        Notification(kind="report_ready", title="Report ready", body=report.title).model_dump()
    )
    return report
