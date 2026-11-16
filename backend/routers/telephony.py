import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import current_user
from services.twilio_service import (
    get_telephony_status,
    make_voice_call,
    send_sms,
    normalize_phone_number,
    dispatch_telephony_alert,
    call_navaneeth_and_kavin,
    MEMBERS_TO_CALL,
)

logger = logging.getLogger("telephony_router")
router = APIRouter(prefix="/telephony", tags=["telephony"])


class TelephonyTestRequest(BaseModel):
    phone_number: str = Field(default="+919865013239", description="Recipient phone number")
    message: Optional[str] = Field(
        default="അടിയന്തര പ്രളയ മുന്നറിയിപ്പ്! ഉടൻ ഉയർന്ന സുരക്ഷിത സ്ഥാനങ്ങളിലേക്ക് മാറുക. Flash flood warning in your area. Evacuate now!",
        description="Evacuation warning text in Malayalam/English",
    )
    make_call: bool = Field(default=True, description="Whether to place a voice call")
    send_message: bool = Field(default=True, description="Whether to send an SMS text")
    language: Optional[str] = Field(default="ml", description="Speech language: 'ml' for Malayalam, 'en' for English")


class CallMembersRequest(BaseModel):
    message: Optional[str] = Field(
        default=None,
        description="Custom speech in Malayalam (defaults to official flash flood warning)",
    )
    send_sms: bool = Field(default=True, description="Send SMS backup to Navaneeth & Kavin")


@router.get("/status")
async def telephony_status(user: dict = Depends(current_user)):
    """Check Twilio integration status, account health, and verified numbers."""
    status_data = await get_telephony_status()
    status_data["emergency_members"] = MEMBERS_TO_CALL
    return status_data


@router.post("/call-members")
async def call_emergency_members(
    payload: Optional[CallMembersRequest] = None,
    user: dict = Depends(current_user),
):
    """
    Trigger emergency voice calls in Malayalam to:
    1. Navaneeth (+919865013239)
    2. Kavin (+919965485711)
    """
    msg = payload.message if payload else None
    send_sms_flag = payload.send_sms if payload else True
    return await call_navaneeth_and_kavin(speech_text=msg, send_sms_backup=send_sms_flag)


@router.post("/test-alert")
async def test_telephony_alert(
    payload: TelephonyTestRequest,
    user: dict = Depends(current_user),
):
    """Trigger a live emergency call and/or text message to test evacuation alerts in Malayalam."""
    phone = normalize_phone_number(payload.phone_number)
    if not phone:
        raise HTTPException(status_code=400, detail="Invalid phone number provided")

    results = {"phone": phone, "call": None, "sms": None, "language": payload.language or "ml"}

    msg_text = payload.message or "അടിയന്തര പ്രളയ മുന്നറിയിപ്പ്! ഉടൻ ഉയർന്ന സുരക്ഷിത സ്ഥാനങ്ങളിലേക്ക് മാറുക. Evacuate immediately!"

    if payload.send_message:
        sms_res = await send_sms(phone, f"🚨 EMERGENCY: {msg_text} (NEXGI Warning)")
        results["sms"] = sms_res

    if payload.make_call:
        voice_res = await make_voice_call(phone, speech_text=msg_text, language=payload.language or "ml")
        results["call"] = voice_res

    return {
        "status": "completed",
        "message": f"Malayalam telephony alert executed for {phone}",
        "results": results,
    }


@router.post("/test-call")
async def test_call_only(
    payload: TelephonyTestRequest,
    user: dict = Depends(current_user),
):
    """Place a live voice call saying the evacuation notice in Malayalam."""
    phone = normalize_phone_number(payload.phone_number)
    if not phone:
        raise HTTPException(status_code=400, detail="Invalid phone number provided")

    res = await make_voice_call(phone, speech_text=payload.message, language=payload.language or "ml")
    if not res.get("success"):
        raise HTTPException(status_code=502, detail=res.get("error", "Twilio call failed"))
    return {"status": "success", "call": res}


@router.post("/test-sms")
async def test_sms_only(
    payload: TelephonyTestRequest,
    user: dict = Depends(current_user),
):
    """Send an SMS text message with the evacuation notice."""
    phone = normalize_phone_number(payload.phone_number)
    if not phone:
        raise HTTPException(status_code=400, detail="Invalid phone number provided")

    res = await send_sms(phone, f"🚨 EMERGENCY: {payload.message} (NEXGI Alert)")
    if not res.get("success"):
        raise HTTPException(status_code=502, detail=res.get("error", "Twilio SMS failed"))
    return {"status": "success", "sms": res}
