from pydantic import BaseModel, Field
from typing import List, Optional, Any
from datetime import datetime

class SensorReading(BaseModel):
    sensor_id: str
    latitude: float
    longitude: float
    rainfall_mm: float = 0.0
    water_level_m: float = 0.0
    river_discharge_m3s: float = 0.0
    soil_moisture: float = 0.0
    temperature_c: float = 0.0
    humidity_pct: float = 0.0
    pressure_hpa: float = 0.0
    vibration_ms2: float = 0.0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    sensor_type: str
    threshold_rainfall: float = 0.0
    threshold_water_level: float = 0.0
    location_name: str = ""
    is_demo: bool = False

class QueryRequest(BaseModel):
    query: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_km: float = 10.0
    include_image_analysis: bool = False
    image_url: Optional[str] = None

class QueryResponse(BaseModel):
    query: str
    location: dict = {}
    risk_level: str = "UNKNOWN"
    confidence: float = 0.0
    answer: str
    sensors: List[dict] = []
    evidence: List[str] = []
    sources: List[str] = []
    recommended_actions: List[str] = []
    missing_data: List[str] = []
    agent_iterations: int = 1
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class RiskRequest(BaseModel):
    latitude: float
    longitude: float
    radius_km: float = 10.0

class RiskResponse(BaseModel):
    risk_level: str
    confidence: float
    reasons: List[str] = []
    evidence: List[str] = []
    recommended_actions: List[str] = []
    sensor_count: int = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class DocumentInfo(BaseModel):
    document_id: str
    filename: str
    upload_time: datetime = Field(default_factory=datetime.utcnow)
    file_type: str
    chunk_count: int
    topics: List[str] = []
    locations: List[str] = []
    status: str = "processed"

class IngestResponse(BaseModel):
    document_id: str
    filename: str
    chunks_created: int
    status: str
    message: str

class HealthResponse(BaseModel):
    status: str = "ok"
    faiss_index_loaded: bool = False
    total_documents: int = 0
    total_sensors: int = 0
    embedding_model: str = ""
    qwen_api_url: str = ""
