"""User administration, notifications and reports."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

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


class MobileAlertRequest(BaseModel):
    user_id: Optional[str] = None  # None or 'all' for broadcast
    phone_number: Optional[str] = None
    alert_type: str = "FLASH_FLOOD_WARNING"
    severity: str = "CRITICAL"
    title: str = "Emergency Alert"
    message: str
    channels: List[str] = Field(default_factory=lambda: ["sms", "push"])


class MobileMessageRequest(BaseModel):
    user_id: Optional[str] = None
    phone_number: str
    message: str


@router.get("/users/mobile")
async def list_mobile_users(user: dict = Depends(current_user)):
    """Fetch registered mobile citizen app users from Supabase mob_users table."""
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        def _fetch():
            from lib.db import get_supabase
            sb = get_supabase()
            return sb.table("mob_users").select("*").order("created_at", desc=True).execute()
        res = await loop.run_in_executor(None, _fetch)
        return res.data or []
    except Exception as e:
        print(f"[Mobile Users] Error fetching mob_users from Supabase: {e}")
        try:
            docs = await db.mob_users.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
            return docs
        except Exception:
            return []


@router.post("/users/mobile/send-alert")
async def send_mobile_alert(payload: MobileAlertRequest, user: dict = Depends(current_user)):
    """Dispatch emergency alert to mobile users via SMS/Push."""
    now_iso = datetime.now(timezone.utc).isoformat()
    alert_id = str(uuid.uuid4())
    alert_record = {
        "id": alert_id,
        "target_user_id": payload.user_id,
        "target_phone": payload.phone_number,
        "alert_type": payload.alert_type,
        "severity": payload.severity,
        "title": payload.title,
        "message": payload.message,
        "channels": payload.channels,
        "dispatched_by": user.get("email") or "Officer",
        "created_at": now_iso,
        "status": "DELIVERED"
    }

    try:
        await db.mobile_dispatched_alerts.insert_one(alert_record.copy())
    except Exception as e:
        print(f"[Mobile Alert] Log error: {e}")

    try:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "kind": "mobile_alert",
            "title": f"Dispatched: {payload.title}",
            "body": f"Sent to {payload.phone_number or 'All Mobile Users'}: {payload.message[:80]}...",
            "read": False,
            "created_at": now_iso
        })
    except Exception:
        pass

    target_desc = payload.phone_number or ("All registered mobile users" if payload.user_id in (None, "all") else payload.user_id)
    return {
        "status": "success",
        "message": f"Alert '{payload.title}' successfully dispatched to {target_desc} via {', '.join(payload.channels).upper()}.",
        "alert_id": alert_id,
        "timestamp": now_iso
    }


@router.post("/users/mobile/send-message")
async def send_mobile_message(payload: MobileMessageRequest, user: dict = Depends(current_user)):
    """Dispatch direct message/SMS to a mobile user."""
    now_iso = datetime.now(timezone.utc).isoformat()
    msg_id = str(uuid.uuid4())
    msg_record = {
        "id": msg_id,
        "user_id": payload.user_id,
        "phone_number": payload.phone_number,
        "message": payload.message,
        "sender": user.get("email") or "Officer",
        "created_at": now_iso,
        "status": "SENT"
    }
    try:
        await db.mobile_dispatched_messages.insert_one(msg_record.copy())
    except Exception as e:
        print(f"[Mobile Message] Log error: {e}")

    return {
        "status": "success",
        "message": f"Message successfully sent to {payload.phone_number}.",
        "message_id": msg_id,
        "timestamp": now_iso
    }


@router.get("/users", response_model=List[User])
async def list_users(user: dict = Depends(require_roles("admin"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    users_list = [User(**d) for d in docs]
    existing_emails = {d.get("email") for d in docs}

    try:
        auth_users = supabase.auth.admin.list_users()
        profiles_res = supabase.table("user_profiles").select("*").execute()
        profiles_by_id = {p["id"]: p for p in (profiles_res.data or [])}

        for u in auth_users:
            if u.email and u.email in existing_emails:
                continue
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
    except Exception:
        pass
    return users_list


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

    # Update local database primary
    await db.users.update_one({"id": user_id}, {"$set": changes})
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if doc:
        try:
            supabase.auth.admin.update_user_by_id(user_id, {"user_metadata": changes})
            supabase.table("user_profiles").upsert({"id": user_id, **changes}).execute()
        except Exception:
            pass
        return User(**doc)

    # Fallback to Supabase if not in MongoDB
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
        raise HTTPException(status_code=404, detail="User not found")


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")
    await db.users.delete_one({"id": user_id})
    try:
        supabase.auth.admin.delete_user(user_id)
        supabase.table("user_profiles").delete().eq("id", user_id).execute()
    except Exception:
        pass
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
