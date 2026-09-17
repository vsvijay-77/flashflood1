"""
Router for external PostgreSQL sensor database (sensor_db)
Provides real-time LoRaWAN node telemetry and packet feeds.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query, Depends

from lib.auth import current_user
from services.external_sensor_service import (
    get_live_sensor_summary,
    get_sensor_history,
    get_lora_packets,
)

router = APIRouter(prefix="/external-sensors", tags=["external-sensors"])


@router.get("/summary")
async def get_summary(user: dict = Depends(current_user)):
    """
    Get live status and telemetry overview from sensor_db.
    """
    return get_live_sensor_summary()


@router.get("/history")
async def get_history(
    device_id: Optional[str] = Query(None, description="Filter by device ID (e.g. LORA_NODE_1)"),
    limit: int = Query(1000, ge=1, le=2000, description="Max rows to return"),
    user: dict = Depends(current_user),
):
    """
    Get historical sensor telemetry readings from sensor_data table.
    """
    return get_sensor_history(device_id=device_id, limit=limit)


@router.get("/packets")
async def get_packets(
    limit: int = Query(50, ge=1, le=200, description="Max packets to return"),
    user: dict = Depends(current_user),
):
    """
    Get raw LoRaWAN packet logs from lora_packets table.
    """
    return get_lora_packets(limit=limit)
