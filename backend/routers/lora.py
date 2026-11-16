import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from lib.db import supabase

logger = logging.getLogger("lora_router")
router = APIRouter(prefix="/lora", tags=["lora"])


class LoRaPacketIn(BaseModel):
    id: Optional[int] = Field(default=None, description="Packet ID")
    rain: Optional[float] = Field(default=0.0)
    water: Optional[float] = Field(default=0.0)
    soil: Optional[float] = Field(default=0.0)
    temperature: Optional[float] = Field(default=0.0)
    humidity: Optional[float] = Field(default=0.0)
    accel_x: Optional[float] = Field(default=0.0)
    accel_y: Optional[float] = Field(default=0.0)
    accel_z: Optional[float] = Field(default=0.0)
    tilt_x: Optional[float] = Field(default=0.0)
    tilt_y: Optional[float] = Field(default=0.0)
    flood: Optional[str] = Field(default="NORMAL")
    lora: Optional[str] = Field(default="READY")


def calibrate_rain_pct(raw: Optional[float]) -> int:
    """
    Rain sensor calibration:
    - Base dry value: 685 -> 0%
    - Torrential rain / flood: <= 150 -> 100%
    """
    val = float(raw if raw is not None else 685.0)
    if val >= 685.0:
        return 0
    if val <= 150.0:
        return 100
    return max(0, min(100, round(((685.0 - val) / (685.0 - 150.0)) * 100.0)))


def calibrate_water_pct(raw: Optional[float]) -> int:
    """
    Water level calibration:
    - 270 = no water (0%)
    - 175 = full (100%)
    - If raw <= 175 (e.g. 99): 100% full / overflow
    - If raw > 270: analog probe scale where 487 = 100%
    """
    val = float(raw if raw is not None else 270.0)
    if val <= 270.0:
        if val >= 270.0:
            return 0
        if val <= 175.0:
            return 100
        return max(0, min(100, round(((270.0 - val) / (270.0 - 175.0)) * 100.0)))
    return max(0, min(100, round((val / 487.0) * 100.0)))


def enrich_record(r: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(r, dict):
        return r
    res = dict(r)
    res["rain_percentage"] = calibrate_rain_pct(res.get("rain_sensor"))
    res["water_percentage"] = calibrate_water_pct(res.get("water_level"))
    return res


@router.get("/transmissions")
async def get_lora_transmissions(limit: int = Query(default=30, ge=1, le=200)):
    """Fetch latest real LoRa field transmission records from Supabase."""
    try:
        res = (
            supabase.table("lora_transmissions")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        data = [enrich_record(item) for item in (res.data or [])]
        return {
            "status": "ok",
            "count": len(data),
            "latest": data[0] if data else None,
            "transmissions": data,
        }
    except Exception as exc:
        logger.error(f"Error fetching lora_transmissions from Supabase: {exc}")
        return {"status": "error", "error": str(exc), "count": 0, "latest": None, "transmissions": []}


@router.get("/latest")
async def get_latest_lora_packet():
    """Fetch the single latest received LoRa transmission packet."""
    try:
        res = (
            supabase.table("lora_transmissions")
            .select("*")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        data = res.data or []
        if not data:
            return {"status": "empty", "packet": None}
        return {"status": "ok", "packet": enrich_record(data[0])}
    except Exception as exc:
        logger.error(f"Error fetching latest packet: {exc}")
        return {"status": "error", "error": str(exc), "packet": None}


@router.post("/transmissions")
async def ingest_lora_packet(payload: LoRaPacketIn):
    """Ingest a LoRa transmission packet from Raspberry Pi or field gateway."""
    try:
        record = {
            "packet_id": payload.id or int(datetime.now(timezone.utc).timestamp()),
            "device_id": f"LORA_NODE_{payload.id or 'FIELD'}",
            "rain_sensor": float(payload.rain or 0.0),
            "water_level": float(payload.water or 0.0),
            "soil_moisture": float(payload.soil or 0.0),
            "temperature": float(payload.temperature or 0.0),
            "humidity": float(payload.humidity or 0.0),
            "accel_x": float(payload.accel_x or 0.0),
            "accel_y": float(payload.accel_y or 0.0),
            "accel_z": float(payload.accel_z or 0.0),
            "tilt_x": float(payload.tilt_x or 0.0),
            "tilt_y": float(payload.tilt_y or 0.0),
            "flood_status": str(payload.flood or "NORMAL"),
            "lora_status": str(payload.lora or "READY"),
            "raw_payload": payload.model_dump(),
        }
        res = supabase.table("lora_transmissions").insert(record).execute()
        return {"status": "created", "record": res.data}
    except Exception as exc:
        logger.error(f"Error saving lora packet: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/transmissions/past-100")
@router.post("/transmissions/delete-past")
async def delete_past_lora_transmissions(
    count: int = Query(default=100, ge=1, le=500, description="Number of past records to delete"),
    mode: str = Query(default="oldest", description="'oldest' to prune historical buffer, 'latest' for recent"),
):
    """Delete past N transmission records from the Supabase database."""
    try:
        desc_order = (mode.lower() == "latest")
        fetch_res = (
            supabase.table("lora_transmissions")
            .select("id")
            .order("created_at", desc=desc_order)
            .limit(count)
            .execute()
        )
        data = fetch_res.data or []
        if not data:
            return {"status": "ok", "deleted_count": 0, "message": "No records found in database to delete."}

        ids_to_delete = [r["id"] for r in data]
        supabase.table("lora_transmissions").delete().in_("id", ids_to_delete).execute()

        logger.info(f"Deleted {len(ids_to_delete)} past lora_transmissions records (mode: {mode})")
        return {
            "status": "ok",
            "deleted_count": len(ids_to_delete),
            "message": f"Successfully deleted {len(ids_to_delete)} past transmission records from database.",
        }
    except Exception as exc:
        logger.error(f"Error deleting past transmissions: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
