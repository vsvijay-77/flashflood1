"""
Agent Router — coordinates parallel data fetching based on the planner's decision.
Accepts injected singletons so they are shared across requests.
"""
import asyncio
from typing import Optional

from app.agents.planner import QueryPlanner
from app.data.sensors import SensorStore
from app.data.weather import WeatherService
from app.data.river import RiverService
from app.data.terrain import TerrainService
from app.data.location import LocationService
from app.rag.retriever import RAGRetriever
from app.rag.vector_store import FAISSVectorStore


class AgentRouter:
    def __init__(
        self,
        sensor_store: Optional[SensorStore] = None,
        vector_store: Optional[FAISSVectorStore] = None,
    ):
        self.planner = QueryPlanner()
        self.sensor_store = sensor_store or SensorStore()
        self.weather_svc = WeatherService()
        self.river_svc = RiverService()
        self.terrain_svc = TerrainService()
        self.location_svc = LocationService()
        self.retriever = RAGRetriever(vector_store=vector_store)

    async def gather_context(
        self, query: str, lat: float, lng: float, radius: float = 10.0
    ) -> dict:
        plan = self.planner.plan(query)

        ctx: dict = {
            "plan": plan,
            "sensors": [],
            "weather": {},
            "river": [],
            "terrain": {},
            "location": {},
            "rag_chunks": [],
            "lat": lat,
            "lng": lng,
            "radius": radius,
        }

        # ── Define async fetch tasks ──────────────────────────────────────────

        async def fetch_sensors():
            if plan["needs_sensors"]:
                sensors = self.sensor_store.get_nearby_sensors(lat, lng, radius)
                ctx["sensors"] = sensors

        async def fetch_weather():
            if plan["needs_weather"]:
                ctx["weather"] = self.weather_svc.get_weather(lat, lng)

        async def fetch_river():
            if plan["needs_river"]:
                ctx["river"] = self.river_svc.get_river_data(lat, lng, radius)

        async def fetch_terrain():
            if plan["needs_terrain"]:
                ctx["terrain"] = self.terrain_svc.get_terrain(lat, lng)

        async def fetch_location():
            if plan["needs_location"]:
                try:
                    loop = asyncio.get_event_loop()
                    info = await loop.run_in_executor(
                        None, self.location_svc.get_location_info, lat, lng
                    )
                    ctx["location"] = info
                except Exception:
                    ctx["location"] = {"latitude": lat, "longitude": lng}

        async def fetch_rag():
            if plan["needs_documents"]:
                loc_filter = (
                    {"latitude": lat, "longitude": lng, "radius_km": radius}
                    if lat and lng
                    else None
                )
                try:
                    loop = asyncio.get_event_loop()
                    chunks = await loop.run_in_executor(
                        None, self.retriever.retrieve, query, loc_filter
                    )
                    ctx["rag_chunks"] = chunks
                except Exception:
                    ctx["rag_chunks"] = []

        # ── Run all fetches in parallel ───────────────────────────────────────
        await asyncio.gather(
            fetch_sensors(),
            fetch_weather(),
            fetch_river(),
            fetch_terrain(),
            fetch_location(),
            fetch_rag(),
            return_exceptions=True,
        )

        return ctx
