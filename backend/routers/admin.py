from datetime import datetime, timezone
import time
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import ROLES, current_user, require_roles
from lib.db import db, supabase
from models.schemas import (
    MessageResponse,
    MobUser,
    MobUserAlertRequest,
    MobUserEvacuationRequest,
    Notification,
    Report,
    ReportCreate,
    User,
    UserAdminUpdate,
)

router = APIRouter(tags=["admin"])


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


# ---------- Mobile App Citizens (mob_users) ----------
@router.get("/mob-users", response_model=List[MobUser])
async def list_mob_users(user: dict = Depends(current_user)):
    """Fetch registered mobile app citizen users from Supabase."""
    try:
        res = supabase.table("mob_users").select("*").order("created_at", desc=True).execute()
        data = res.data or []
        return [MobUser(**u) for u in data]
    except Exception as exc:
        print(f"Error fetching mob_users from Supabase: {exc}")
        return []


@router.post("/mob-users/{user_id}/alert")
async def send_mob_user_alert(
    user_id: str,
    payload: MobUserAlertRequest,
    admin: dict = Depends(require_roles("admin", "gov_officer")),
):
    """Dispatch emergency alert to a citizen (updates mob_users.preferences, alerts, notifications)."""
    try:
        res = supabase.table("mob_users").select("*").eq("id", user_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Mobile citizen user not found")
        target_user = res.data[0]

        now_iso = datetime.now(timezone.utc).isoformat()
        prefs = target_user.get("preferences") or {}
        alert_data = {
            "hazard_type": payload.hazard_type,
            "risk_level": payload.risk_level,
            "title": payload.title,
            "detail": payload.detail,
            "sent_at": now_iso,
            "active": True,
        }
        prefs["active_alert"] = alert_data

        # 1. Update mob_users
        supabase.table("mob_users").update({"preferences": prefs, "updated_at": now_iso}).eq("id", user_id).execute()

        # 2. Insert into public.alerts
        try:
            supabase.table("alerts").insert({
                "id": str(uuid.uuid4()),
                "code": f"ALT-{int(time.time())}",
                "zone_id": "ZONE-POLLACHI",
                "location": target_user.get("location_name") or "Pollachi Sector",
                "hazard_type": payload.hazard_type,
                "risk_level": payload.risk_level,
                "title": payload.title,
                "detail": payload.detail,
                "status": "active",
                "assigned_to": target_user.get("full_name") or "Citizen",
            }).execute()
        except Exception as alert_err:
            print(f"Notice: alerts table insert failed: {alert_err}")

        # 3. Insert into public.notifications
        try:
            supabase.table("notifications").insert({
                "id": str(uuid.uuid4()),
                "kind": "flood_alert",
                "title": f"🚨 {payload.title}",
                "body": payload.detail,
                "read": False,
            }).execute()
        except Exception as notif_err:
            print(f"Notice: notifications table insert failed: {notif_err}")

        # 4. Mirror to mongo notifications
        await db.notifications.insert_one({
            "kind": "critical_alert",
            "title": f"🚨 Mobile Alert to {target_user.get('full_name') or 'Citizen'}: {payload.title}",
            "body": payload.detail,
            "read": False,
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "status": "ok",
            "message": f"Alert successfully dispatched to {target_user.get('full_name') or 'Citizen'}",
            "alert": alert_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to dispatch alert: {str(e)}")


@router.post("/mob-users/{user_id}/evacuation-point")
async def send_mob_user_evacuation(
    user_id: str,
    payload: MobUserEvacuationRequest,
    admin: dict = Depends(require_roles("admin", "gov_officer")),
):
    """Assign emergency evacuation point to a citizen."""
    try:
        res = supabase.table("mob_users").select("*").eq("id", user_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Mobile citizen user not found")
        target_user = res.data[0]

        now_iso = datetime.now(timezone.utc).isoformat()
        prefs = target_user.get("preferences") or {}
        evac_data = {
            "shelter_name": payload.shelter_name,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "elevation_m": payload.elevation_m,
            "instructions": payload.instructions or "Proceed immediately to the designated safe evacuation shelter.",
            "assigned_at": now_iso,
        }
        prefs["evacuation_point"] = evac_data

        # 1. Update mob_users
        supabase.table("mob_users").update({"preferences": prefs, "updated_at": now_iso}).eq("id", user_id).execute()

        # 2. Insert into public.notifications
        try:
            supabase.table("notifications").insert({
                "id": str(uuid.uuid4()),
                "kind": "evacuation_order",
                "title": f"🏃 Evacuation Assigned: {payload.shelter_name}",
                "body": f"Proceed to {payload.shelter_name} ({payload.latitude}, {payload.longitude}). {payload.instructions}",
                "read": False,
            }).execute()
        except Exception as notif_err:
            print(f"Notice: notifications table insert failed: {notif_err}")

        # 3. Insert into public.alerts
        try:
            supabase.table("alerts").insert({
                "id": str(uuid.uuid4()),
                "code": f"EVAC-{int(time.time())}",
                "zone_id": "ZONE-POLLACHI",
                "location": target_user.get("location_name") or f"Coords ({payload.latitude}, {payload.longitude})",
                "hazard_type": "Evacuation Order",
                "risk_level": "critical",
                "title": f"Evacuate to {payload.shelter_name}",
                "detail": payload.instructions or "Proceed immediately to shelter.",
                "status": "active",
                "assigned_to": target_user.get("full_name") or "Citizen",
            }).execute()
        except Exception as alert_err:
            print(f"Notice: alerts table insert failed: {alert_err}")

        # 4. Mirror to mongo notifications
        await db.notifications.insert_one({
            "kind": "critical_alert",
            "title": f"🏃 Evacuation Assigned to {target_user.get('full_name') or 'Citizen'}: {payload.shelter_name}",
            "body": f"Shelter: {payload.shelter_name} ({payload.latitude}, {payload.longitude}). {payload.instructions}",
            "read": False,
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "status": "ok",
            "message": f"Evacuation point assigned to {target_user.get('full_name') or 'Citizen'}",
            "evacuation_point": evac_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to assign evacuation point: {str(e)}")


@router.delete("/mob-users/{user_id}/alert")
async def clear_mob_user_alert(
    user_id: str,
    admin: dict = Depends(require_roles("admin", "gov_officer")),
):
    """Clear active alert for a mobile citizen."""
    try:
        res = supabase.table("mob_users").select("*").eq("id", user_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Mobile citizen user not found")
        target_user = res.data[0]

        now_iso = datetime.now(timezone.utc).isoformat()
        prefs = target_user.get("preferences") or {}
        if "active_alert" in prefs:
            del prefs["active_alert"]

        supabase.table("mob_users").update({"preferences": prefs, "updated_at": now_iso}).eq("id", user_id).execute()
        return {"status": "ok", "message": f"Alert cleared for {target_user.get('full_name') or 'Citizen'}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear alert: {str(e)}")

