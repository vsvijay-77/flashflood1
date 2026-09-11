"""
Agentic RAG System — FastAPI Application
Flash-Flood & Disaster Management Intelligence
"""
import os
import uuid
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Query as QParam
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import settings
from app.schemas.models import (
    QueryRequest, QueryResponse, RiskRequest, RiskResponse,
    SensorReading, IngestResponse, HealthResponse, DocumentInfo
)
from app.rag.ingest import DocumentIngestor
from app.rag.vector_store import FAISSVectorStore
from app.rag.embeddings import get_embedding_engine
from app.agents.router import AgentRouter
from app.agents.response_agent import ResponseAgent
from app.agents.prediction_agent import PredictionAgent
from app.data.sensors import SensorStore
from app.model.qwen_client import QwenClient

# ─── Module-level singletons (created once, reused across all requests) ───────
_vector_store: Optional[FAISSVectorStore] = None
_sensor_store: Optional[SensorStore] = None


def get_vector_store() -> FAISSVectorStore:
    global _vector_store
    if _vector_store is None:
        _vector_store = FAISSVectorStore()
    return _vector_store


def get_sensor_store() -> SensorStore:
    global _sensor_store
    if _sensor_store is None:
        _sensor_store = SensorStore()
    return _sensor_store


# ─── App setup ────────────────────────────────────────────────────────────────
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".docx", ".csv", ".json"}
MAX_UPLOAD_BYTES = settings.max_upload_size_mb * 1024 * 1024

app = FastAPI(
    title="Agentic RAG — Flash Flood Intelligence",
    description="Production-quality Agentic RAG for disaster management using Qwen2.5-VL",
    version="1.0.0",
)

origins = [o.strip() for o in settings.cors_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    # Ensure all directories exist
    for path in [
        settings.docs_upload_path,
        settings.docs_processed_path,
        settings.sensor_data_path,
        settings.historical_data_path,
        str(Path(settings.faiss_index_path).parent),
    ]:
        Path(path).mkdir(parents=True, exist_ok=True)

    # Initialize singletons
    get_vector_store()
    get_sensor_store()

    # Warm up embedding model in background
    asyncio.create_task(_warm_embeddings())

    print(f"✅ Agentic RAG started | Qwen API: {settings.qwen_api_url}")


async def _warm_embeddings():
    """Pre-load embedding model so first query isn't slow."""
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: get_embedding_engine().encode(["warmup"]))
        print("✅ Embedding model loaded")
    except Exception as e:
        print(f"⚠️  Embedding warmup error: {e}")


# ─── HEALTH ───────────────────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    vs = get_vector_store()
    ss = get_sensor_store()
    return HealthResponse(
        status="ok",
        faiss_index_loaded=vs.index is not None,
        total_documents=len(vs.get_document_list()),
        total_sensors=len(ss.get_all_sensors()),
        embedding_model=settings.embedding_model,
        qwen_api_url=settings.qwen_api_url,
    )


# ─── RAG: UPLOAD ──────────────────────────────────────────────────────────────
@app.post("/rag/upload", tags=["RAG"])
async def upload_document(file: UploadFile = File(...)):
    """Upload a disaster-management document (PDF, TXT, DOCX, CSV, JSON)."""
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Allowed: {ALLOWED_EXTENSIONS}")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Max {settings.max_upload_size_mb} MB.")

    # Use a stable document_id based on filename
    document_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, file.filename))
    dest = Path(settings.docs_upload_path) / file.filename
    dest.write_bytes(content)

    return {
        "document_id": document_id,
        "filename": file.filename,
        "size_bytes": len(content),
        "file_type": ext,
        "message": "Uploaded successfully. Call POST /rag/ingest to index it.",
    }


# ─── RAG: INGEST ──────────────────────────────────────────────────────────────
@app.post("/rag/ingest", response_model=IngestResponse, tags=["RAG"])
async def ingest_document(filename: str = Form(...)):
    """Process and embed an uploaded document into the FAISS vector store."""
    file_path = Path(settings.docs_upload_path) / filename
    if not file_path.exists():
        raise HTTPException(404, f"File '{filename}' not found in upload directory.")

    document_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, filename))

    ingestor = DocumentIngestor()
    try:
        chunks = ingestor.process_file(file_path, document_id)
    except Exception as e:
        raise HTTPException(500, f"Ingestion failed: {e}")

    vs = get_vector_store()
    vs.add_chunks(chunks)

    return IngestResponse(
        document_id=document_id,
        filename=filename,
        chunks_created=len(chunks),
        status="processed",
        message=f"Successfully indexed {len(chunks)} chunks from '{filename}'.",
    )


# ─── RAG: LIST DOCUMENTS ──────────────────────────────────────────────────────
@app.get("/rag/documents", tags=["RAG"])
async def list_documents():
    """List all indexed documents."""
    vs = get_vector_store()
    return vs.get_document_list()


# ─── RAG: DELETE DOCUMENT ─────────────────────────────────────────────────────
@app.delete("/rag/documents/{document_id}", tags=["RAG"])
async def delete_document(document_id: str):
    """Remove a document and all its chunks from the vector store."""
    vs = get_vector_store()
    removed = vs.delete_document(document_id)
    return {"message": f"Removed {removed} chunks for document '{document_id}'."}


# ─── SENSORS: UPDATE ──────────────────────────────────────────────────────────
@app.post("/sensors/update", tags=["Sensors"])
async def update_sensor(reading: SensorReading):
    """Ingest a new sensor reading."""
    ss = get_sensor_store()
    ss.update_sensor(reading)
    return {
        "status": "ok",
        "sensor_id": reading.sensor_id,
        "is_demo": reading.is_demo,
        "timestamp": reading.timestamp,
    }


# ─── SENSORS: NEARBY ──────────────────────────────────────────────────────────
@app.get("/sensors/nearby", tags=["Sensors"])
async def nearby_sensors(
    latitude: float = QParam(..., ge=-90, le=90),
    longitude: float = QParam(..., ge=-180, le=180),
    radius_km: float = QParam(10.0, gt=0, le=500),
):
    """Get all sensors within radius_km of (latitude, longitude)."""
    ss = get_sensor_store()
    sensors = ss.get_nearby_sensors(latitude, longitude, radius_km)
    return [s.model_dump(mode="json") for s in sensors]


# ─── QUERY: MAIN AGENTIC RAG ENDPOINT ─────────────────────────────────────────
@app.post("/query", response_model=QueryResponse, tags=["Query"])
async def query(req: QueryRequest):
    """
    Full Agentic RAG pipeline:
    1. Plan what data is needed
    2. Fetch in parallel (sensors, weather, river, terrain, location, RAG docs)
    3. Run prediction agent for risk level
    4. Build structured prompt and call Qwen2.5-VL
    5. Return structured disaster intelligence response
    """
    if req.latitude is not None and (req.latitude < -90 or req.latitude > 90):
        raise HTTPException(400, "latitude must be between -90 and 90")
    if req.longitude is not None and (req.longitude < -180 or req.longitude > 180):
        raise HTTPException(400, "longitude must be between -180 and 180")

    # Inject singletons into the router so it reuses them
    router = AgentRouter(
        sensor_store=get_sensor_store(),
        vector_store=get_vector_store(),
    )
    ctx = await router.gather_context(
        query=req.query,
        lat=req.latitude or 0.0,
        lng=req.longitude or 0.0,
        radius=req.radius_km,
    )

    resp_agent = ResponseAgent()
    return await resp_agent.generate_response(req.query, ctx)


# ─── QUERY: STREAMING ─────────────────────────────────────────────────────────
@app.post("/query/stream", tags=["Query"])
async def query_stream(req: QueryRequest):
    """
    Streaming version of /query — returns Server-Sent Events.
    Each Qwen output token is emitted immediately as:
        data: <token text>\n\n
    Newlines inside tokens are replaced with the SSE-safe literal \\n.
    """
    if req.latitude is not None and (req.latitude < -90 or req.latitude > 90):
        raise HTTPException(400, "latitude must be between -90 and 90")
    if req.longitude is not None and (req.longitude < -180 or req.longitude > 180):
        raise HTTPException(400, "longitude must be between -180 and 180")

    router = AgentRouter(
        sensor_store=get_sensor_store(),
        vector_store=get_vector_store(),
    )
    ctx = await router.gather_context(
        query=req.query,
        lat=req.latitude or 0.0,
        lng=req.longitude or 0.0,
        radius=req.radius_km,
    )

    resp_agent = ResponseAgent()

    async def event_stream():
        try:
            async for chunk in resp_agent.stream_response(req.query, ctx):
                if chunk:
                    # Replace literal newlines so SSE "data:" line stays intact
                    safe = chunk.replace("\n", "\\n")
                    yield f"data: {safe}\n\n"
            # Signal stream end
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ─── RISK ANALYSIS ────────────────────────────────────────────────────────────
@app.post("/risk/analyze", response_model=RiskResponse, tags=["Risk"])
async def risk_analyze(req: RiskRequest):
    """Rule-based flood risk assessment for a location."""
    router = AgentRouter(
        sensor_store=get_sensor_store(),
        vector_store=get_vector_store(),
    )
    ctx = await router.gather_context("risk analysis", req.latitude, req.longitude, req.radius_km)

    pred = PredictionAgent()
    risk, conf, reasons, evidence, actions = pred.analyze_risk(ctx)

    return RiskResponse(
        risk_level=risk,
        confidence=conf,
        reasons=reasons,
        evidence=evidence,
        recommended_actions=actions,
        sensor_count=len(ctx.get("sensors", [])),
    )


# ─── AREA SUMMARY ─────────────────────────────────────────────────────────────
@app.get("/area/{latitude}/{longitude}", tags=["Area"])
async def area_summary(
    latitude: float,
    longitude: float,
    radius_km: float = QParam(10.0, gt=0),
):
    """Quick summary of an area: sensors, risk level, location info."""
    if latitude < -90 or latitude > 90:
        raise HTTPException(400, "latitude must be between -90 and 90")
    if longitude < -180 or longitude > 180:
        raise HTTPException(400, "longitude must be between -180 and 180")

    router = AgentRouter(
        sensor_store=get_sensor_store(),
        vector_store=get_vector_store(),
    )
    ctx = await router.gather_context("area summary", latitude, longitude, radius_km)

    pred = PredictionAgent()
    risk, conf, reasons, evidence, actions = pred.analyze_risk(ctx)

    sensors_list = [s.model_dump(mode="json") for s in ctx.get("sensors", [])]

    return {
        "location": ctx.get("location", {}),
        "risk_level": risk,
        "confidence": conf,
        "reasons": reasons,
        "recommended_actions": actions,
        "sensor_count": len(sensors_list),
        "sensors": sensors_list,
        "weather": ctx.get("weather", {}),
        "river_data": ctx.get("river", []),
        "terrain": ctx.get("terrain", {}),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── IMAGE ANALYSIS ───────────────────────────────────────────────────────────
@app.post("/image/analyze", tags=["Image"])
async def analyze_image(
    file: Optional[UploadFile] = File(None),
    image_url: Optional[str] = Form(None),
    query: str = Form("Analyze this image for flood and disaster indicators."),
):
    """Analyze a satellite or field image using Qwen2.5-VL."""
    if file is None and not image_url:
        raise HTTPException(400, "Provide either a file upload or an image_url.")

    qwen = QwenClient()

    if file:
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Image too large.")
        # Save temp
        tmp_path = Path("/tmp") / f"img_{uuid.uuid4()}{Path(file.filename).suffix}"
        tmp_path.write_bytes(content)
        result = await qwen.analyze_image(str(tmp_path), query)
        tmp_path.unlink(missing_ok=True)
    else:
        result = await qwen.analyze_image(image_url, query)

    return {
        "query": query,
        "analysis": result,
        "source": "Qwen2.5-VL Image Endpoint",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── QWEN CONNECTIVITY TEST ───────────────────────────────────────────────────
@app.get("/health/qwen", tags=["System"])
async def test_qwen():
    """Test connectivity to the Qwen2.5-VL API."""
    qwen = QwenClient()
    ok = await qwen.test_connection()
    answer = None
    if ok:
        try:
            answer = await qwen.generate_text(
                user_prompt="Say 'Qwen API connected successfully' in one sentence.",
                system_prompt="You are a helpful assistant.",
                max_tokens=50,
            )
        except Exception as e:
            answer = f"Connection OK but generation failed: {e}"
    return {
        "qwen_reachable": ok,
        "qwen_api_url": settings.qwen_api_url,
        "test_response": answer,
    }
