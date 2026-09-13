from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime
import asyncio


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import db


# Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
@asynccontextmanager
async def lifespan(app: FastAPI):
    async def _seed_chat_knowledge():
        try:
            from services.qdrant_service import knowledge_store
            await knowledge_store.seed_defaults()
        except Exception as exc:
            logger.warning("Qdrant knowledge seed skipped (non-fatal): %s", exc)

    asyncio.create_task(_seed_chat_knowledge())
    # Pre-warm GEE tile cache in a background daemon thread on startup.
    # Daemon thread ensures Uvicorn reload / shutdown is never blocked.
    def _warm_gee_target():
        try:
            from routers.gee import _get_elevation_tiles, _ensure_gee
            _ensure_gee()
            _get_elevation_tiles()
            logger.info("GEE STM 30 / elevation tile cache pre-warmed successfully.")
        except Exception as exc:
            logger.warning(f"GEE cache pre-warm failed (non-fatal): {exc}")

    import threading
    threading.Thread(target=_warm_gee_target, daemon=True).start()
    yield


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.model_dump())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# Feature routers — mounted onto api_router so everything stays under /api
from routers.admin import router as admin_router  # noqa: E402
from routers.alerts import router as alerts_router  # noqa: E402
from routers.auth import router as auth_router  # noqa: E402
from routers.intelligence import router as intelligence_router  # noqa: E402
from routers.network import router as network_router  # noqa: E402
from routers.satellite import router as satellite_router  # noqa: E402

from routers.gee import router as gee_router  # noqa: E402
from routers.digital_twin import router as digital_twin_router  # noqa: E402
from routers.routing_and_rivers import router as routing_and_rivers_router  # noqa: E402
from routers.buildings import router as buildings_router  # noqa: E402
from routers.chat import router as chat_router  # noqa: E402
from routers.sensor_data import router as sensor_data_router  # noqa: E402

api_router.include_router(auth_router)
api_router.include_router(network_router)
api_router.include_router(alerts_router)
api_router.include_router(intelligence_router)
api_router.include_router(admin_router)
api_router.include_router(satellite_router)
api_router.include_router(gee_router)
api_router.include_router(digital_twin_router)
api_router.include_router(routing_and_rivers_router)
api_router.include_router(buildings_router)
api_router.include_router(chat_router)
api_router.include_router(sensor_data_router)


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
