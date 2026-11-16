import os
import re
import asyncio
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("twilio_service")

# Default credentials provided by operator
DEFAULT_TWILIO_SID = "AC71d22376b5666a6090b3b584c26efb46"
DEFAULT_TWILIO_AUTH = "cc9c939cbe782bf56ccb2fc7ddc1fe02"
DEFAULT_TWILIO_PHONE = "+15632393112"


def get_twilio_credentials() -> Dict[str, str]:
    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip() or DEFAULT_TWILIO_SID
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip() or DEFAULT_TWILIO_AUTH
    phone_number = os.getenv("TWILIO_PHONE_NUMBER", "").strip() or DEFAULT_TWILIO_PHONE
    return {
        "account_sid": account_sid,
        "auth_token": auth_token,
        "phone_number": phone_number,
    }


def get_twilio_client():
    creds = get_twilio_credentials()
    if not creds["account_sid"] or not creds["auth_token"]:
        return None
    try:
        from twilio.rest import Client
        return Client(creds["account_sid"], creds["auth_token"])
    except Exception as e:
        logger.error(f"[Twilio] Failed to initialize client: {e}")
        return None


def normalize_phone_number(raw_phone: str, default_country_code: str = "+91") -> str:
    """Normalize phone string into E.164 international format (e.g. +919003899180)."""
    if not raw_phone:
        return ""
    # Strip whitespace, hyphens, parens, dots
    cleaned = re.sub(r"[\s\-\(\)\.]+", "", str(raw_phone).strip())
    if not cleaned:
        return ""

    if cleaned.startswith("+"):
        return cleaned

    # Check 10-digit standard Indian mobile numbers (starts with 6-9)
    if len(cleaned) == 10 and cleaned[0] in "6789":
        return f"+91{cleaned}"

    # Check 11-digit starting with 0
    if len(cleaned) == 11 and cleaned.startswith("0") and cleaned[1] in "6789":
        return f"+91{cleaned[1:]}"

    # Check 11-digit starting with 1 (US / Canada)
    if len(cleaned) == 11 and cleaned.startswith("1"):
        return f"+{cleaned}"

    # Check 12-digit starting with 91
    if len(cleaned) == 12 and cleaned.startswith("91"):
        return f"+{cleaned}"

    # Default fallback prepend country code if missing '+'
    if not cleaned.startswith("+"):
        return f"{default_country_code}{cleaned}"

    return cleaned


MEMBERS_TO_CALL = [
    {"name": "Navaneeth", "phone": "+919865013239"},
    {"name": "Kavin", "phone": "+919965485711"},
]

MALAYALAM_FLASH_FLOOD_SPEECH = (
    "അടിയന്തര പ്രളയ മുന്നറിയിപ്പ്! നിങ്ങളുടെ പ്രദേശത്ത് അതിശക്തമായ മിന്നൽ പ്രളയ സാധ്യതയുണ്ട്. "
    "ദയവായി ഉടൻ തന്നെ ഉയർന്ന സുരക്ഷിത സ്ഥാനങ്ങളിലേക്ക് മാറുക. "
    "നദീതീരങ്ങളിലും താഴ്ന്ന പ്രദേശങ്ങളിലും നിൽക്കരുത്. ഉടൻ സുരക്ഷിത സ്ഥാനത്തേക്ക് മാറുക!"
)

MALAYALAM_SMS_ALERT = (
    "🚨 അടിയന്തര മുന്നറിയിപ്പ്: മിന്നൽ പ്രളയ സാധ്യത (Flash Flood Warning). "
    "ഉടൻ സുരക്ഷിത സ്ഥാനത്തേക്ക് മാറുക! Seek high ground immediately! - NEXGI Alert"
)


MALAYALAM_ALERT_AUDIO_URL = "https://xmtuwcywlfdoarwzkmod.supabase.co/storage/v1/object/public/alerts/alert_malayalam.mp3"


def build_evacuation_voice_twiml(
    message_text: Optional[str] = None,
    language: str = "ml",
) -> str:
    """Build TwiML XML speech payload instructing immediate evacuation in Malayalam (via high-fidelity audio) and English."""
    lang_lower = (language or "ml").lower()

    if lang_lower in ("ml", "ml-in", "malayalam"):
        # Real native Malayalam audio stream + clear English instructions
        english_clean = "Emergency Warning! Flash flood alert in your area. Evacuate immediately to high ground."
        return (
            f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<Response>\n'
            f'  <Play>{MALAYALAM_ALERT_AUDIO_URL}</Play>\n'
            f'  <Pause length="1"/>\n'
            f'  <Say voice="alice" language="en-IN">{english_clean}</Say>\n'
            f'  <Pause length="1"/>\n'
            f'  <Play>{MALAYALAM_ALERT_AUDIO_URL}</Play>\n'
            f'</Response>'
        )

    # Standard English fallback
    speech = (
        message_text.strip()
        if message_text
        else "Emergency Warning! Flood in area, evacuate now! Flood in area, evacuate now! Seek high ground immediately and avoid low lying bridges and riverbanks."
    )
    speech_clean = (
        speech.replace("&", "and")
        .replace("<", "")
        .replace(">", "")
        .replace('"', "")
        .replace("'", "")
    )
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<Response>\n'
        f'  <Say voice="alice" language="en-US">{speech_clean}</Say>\n'
        f'  <Pause length="1"/>\n'
        f'  <Say voice="alice" language="en-US">Repeat: {speech_clean}</Say>\n'
        f'</Response>'
    )


async def send_sms(to_phone: str, message: str) -> Dict[str, Any]:
    """Send an SMS alert via Twilio asynchronously."""
    normalized_to = normalize_phone_number(to_phone)
    if not normalized_to:
        return {"success": False, "error": "Invalid or missing recipient phone number"}

    creds = get_twilio_credentials()
    client = get_twilio_client()
    if not client:
        return {"success": False, "error": "Twilio client could not be initialized"}

    def _sync_send():
        return client.messages.create(
            body=message,
            from_=creds["phone_number"],
            to=normalized_to,
        )

    try:
        msg = await asyncio.to_thread(_sync_send)
        logger.info(f"[Twilio SMS] Sent to {normalized_to} - SID: {msg.sid} Status: {msg.status}")
        return {
            "success": True,
            "sid": msg.sid,
            "status": msg.status,
            "recipient": normalized_to,
            "from": creds["phone_number"],
        }
    except Exception as e:
        logger.error(f"[Twilio SMS] Error sending to {normalized_to}: {e}")
        return {"success": False, "error": str(e), "recipient": normalized_to}


async def make_voice_call(
    to_phone: str,
    speech_text: Optional[str] = None,
    language: str = "ml",
) -> Dict[str, Any]:
    """Place an outbound emergency voice call via Twilio that speaks the evacuation notice in Malayalam."""
    normalized_to = normalize_phone_number(to_phone)
    if not normalized_to:
        return {"success": False, "error": "Invalid or missing recipient phone number"}

    creds = get_twilio_credentials()
    client = get_twilio_client()
    if not client:
        return {"success": False, "error": "Twilio client could not be initialized"}

    twiml = build_evacuation_voice_twiml(speech_text, language=language)

    def _sync_call():
        return client.calls.create(
            twiml=twiml,
            from_=creds["phone_number"],
            to=normalized_to,
        )

    try:
        call = await asyncio.to_thread(_sync_call)
        logger.info(f"[Twilio Voice Call] Initiated to {normalized_to} (lang: {language}) - SID: {call.sid} Status: {call.status}")
        return {
            "success": True,
            "sid": call.sid,
            "status": call.status,
            "recipient": normalized_to,
            "language": language,
            "from": creds["phone_number"],
        }
    except Exception as e:
        logger.error(f"[Twilio Voice Call] Error calling {normalized_to}: {e}")
        return {"success": False, "error": str(e), "recipient": normalized_to}


async def call_navaneeth_and_kavin(
    speech_text: Optional[str] = None,
    send_sms_backup: bool = True,
) -> Dict[str, Any]:
    """Call Navaneeth (9865013239) and Kavin (9965485711) with Malayalam flash flood warning."""
    results = []
    for member in MEMBERS_TO_CALL:
        phone = member["phone"]
        name = member["name"]
        call_res = await make_voice_call(phone, speech_text=speech_text, language="ml")
        sms_res = None
        if send_sms_backup:
            sms_res = await send_sms(phone, MALAYALAM_SMS_ALERT)
        results.append({
            "name": name,
            "phone": phone,
            "call": call_res,
            "sms": sms_res,
        })
    return {
        "status": "completed",
        "message": "Malayalam flash flood voice alert dispatched to Navaneeth & Kavin",
        "results": results,
    }


async def dispatch_telephony_alert(
    phone_number: str,
    channels: List[str],
    title: str = "Flood in area evacuate now",
    detail: Optional[str] = None,
    hazard_type: str = "Flood",
    language: str = "ml",
) -> Dict[str, Any]:
    """Dispatch SMS and/or Voice Call according to selected channels in Malayalam."""
    normalized = normalize_phone_number(phone_number)
    results: Dict[str, Any] = {"phone": normalized, "channels": channels, "actions": {}}

    if not normalized:
        results["error"] = "No valid phone number for citizen"
        return results

    channels_lower = [c.lower() for c in (channels or [])]

    # Prepare speech and SMS text
    sms_text = (
        f"🚨 EMERGENCY ALERT: {title}. {detail or 'Seek high ground immediately.'} (NEXGI Early Warning)"
    )
    voice_speech = (
        f"Emergency warning. {title}. {detail or 'Evacuate now. Seek high ground immediately.'}"
    )

    # 1. SMS Message
    if "message" in channels_lower or "sms" in channels_lower:
        sms_res = await send_sms(normalized, sms_text)
        results["actions"]["sms"] = sms_res

    # 2. Voice Call
    if "call" in channels_lower or "voice" in channels_lower or "ivr" in channels_lower:
        call_res = await make_voice_call(normalized, voice_speech, language=language)
        results["actions"]["call"] = call_res

    return results


async def get_telephony_status() -> Dict[str, Any]:
    """Retrieve Twilio status, sender phone number, and verified caller IDs."""
    creds = get_twilio_credentials()
    client = get_twilio_client()
    if not client:
        return {"configured": False, "error": "Twilio credentials not configured"}

    def _sync_status():
        acc = client.api.accounts(creds["account_sid"]).fetch()
        caller_ids = client.outgoing_caller_ids.list()
        return {
            "configured": True,
            "account_name": acc.friendly_name,
            "account_status": acc.status,
            "account_type": acc.type,
            "sender_phone": creds["phone_number"],
            "account_sid": creds["account_sid"][:6] + "..." + creds["account_sid"][-4:],
            "verified_recipients": [c.phone_number for c in caller_ids],
        }

    try:
        return await asyncio.to_thread(_sync_status)
    except Exception as e:
        return {"configured": False, "error": str(e), "sender_phone": creds["phone_number"]}
