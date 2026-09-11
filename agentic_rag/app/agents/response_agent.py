"""
Response Agent — builds the full structured prompt and calls Qwen2.5-VL.
Implements up to MAX_AGENT_ITERATIONS agentic loops for context enrichment.
"""
import asyncio
from datetime import datetime, timezone
from typing import AsyncGenerator

from app.model.qwen_client import QwenClient
from app.agents.prediction_agent import PredictionAgent
from app.schemas.models import QueryResponse

MAX_AGENT_ITERATIONS = 3

SYSTEM_PROMPT_TEMPLATE = """ROLE:
You are a disaster-management intelligence assistant specializing in flash-flood risk analysis.

OBJECTIVE:
Analyze the retrieved evidence below and provide accurate, location-specific flood and disaster information.

RULES:
1. Use the retrieved evidence before answering.
2. Never invent sensor readings, weather data, or river levels.
3. Clearly distinguish between live sensor data, historical data, and retrieved documents.
4. If information is missing, explicitly state it is unavailable.
5. Do not claim certainty for predictions — label them as estimates.
6. For HIGH or CRITICAL risk situations, provide clear recommended actions.
7. Do not replace official emergency authorities or certified forecasts.
8. Be concise but thorough.
9. Identify sources for your statements (sensor ID, document name, etc.).
10. If you cannot answer confidently, say "Insufficient data to answer reliably."

CURRENT LOCATION:
Latitude: {latitude}
Longitude: {longitude}
Area: {area_name}

LIVE SENSOR DATA:
{sensor_context}

WEATHER DATA:
{weather_context}

RIVER DATA:
{river_context}

TERRAIN DATA:
{terrain_context}

RETRIEVED KNOWLEDGE (from disaster-management documents):
{rag_context}

RISK ASSESSMENT:
Risk Level: {risk_level}
Confidence: {confidence}%
Reasons: {risk_reasons}

RESPONSE REQUIREMENTS:
- Give the direct answer first.
- Explain the main evidence.
- Mention relevant sensor readings and their IDs.
- State the location name.
- State confidence level.
- If risk is HIGH or CRITICAL, list recommended actions.
- Clearly identify any missing information."""


def _build_sensor_context(sensors: list) -> str:
    if not sensors:
        return "No sensor data available for this location."
    lines = []
    for s in sensors:
        demo = "[DEMO DATA] " if getattr(s, "is_demo", False) else ""
        parts = [f"Sensor {demo}{s.sensor_id} ({s.sensor_type or 'generic'}) @ {s.location_name or f'{s.latitude:.4f},{s.longitude:.4f}'}:"]
        if s.rainfall_mm:
            parts.append(f"  Rainfall: {s.rainfall_mm} mm/hr (threshold: {s.threshold_rainfall or 'N/A'})")
        if s.water_level_m:
            parts.append(f"  Water Level: {s.water_level_m} m (threshold: {s.threshold_water_level or 'N/A'})")
        if s.river_discharge_m3s:
            parts.append(f"  River Discharge: {s.river_discharge_m3s} m³/s")
        if s.soil_moisture:
            parts.append(f"  Soil Moisture: {s.soil_moisture:.0%}")
        if s.temperature_c:
            parts.append(f"  Temperature: {s.temperature_c}°C  Humidity: {s.humidity_pct}%")
        parts.append(f"  Timestamp: {s.timestamp}")
        lines.append("\n".join(parts))
    return "\n\n".join(lines)


def _build_weather_context(weather: dict) -> str:
    if not weather:
        return "No weather data available."
    demo = "[DEMO DATA] " if weather.get("is_demo") else ""
    return (
        f"{demo}Condition: {weather.get('weather_condition', 'Unknown')}\n"
        f"Temperature: {weather.get('temperature_c', 'N/A')}°C  Humidity: {weather.get('humidity_pct', 'N/A')}%\n"
        f"Rainfall last 1h: {weather.get('precipitation_mm_1h', 'N/A')} mm\n"
        f"Rainfall last 24h: {weather.get('precipitation_mm_24h', 'N/A')} mm\n"
        f"Wind: {weather.get('wind_speed_kmh', 'N/A')} km/h {weather.get('wind_direction', '')}\n"
        f"Source: {weather.get('data_source', 'Unknown')}"
    )


def _build_river_context(rivers: list) -> str:
    if not rivers:
        return "No river/water-level data available."
    lines = []
    for r in rivers:
        demo = "[DEMO DATA] " if r.get("is_demo") else ""
        lines.append(
            f"{demo}{r.get('river_name', 'River')} — {r.get('station_name', '')}:\n"
            f"  Level: {r.get('water_level_m', 'N/A')} m  "
            f"(Warning: {r.get('warning_level_m', 'N/A')} m  Danger: {r.get('danger_level_m', 'N/A')} m)\n"
            f"  Trend: {r.get('trend', 'unknown').upper()}  Status: {r.get('status', 'unknown').upper()}\n"
            f"  Discharge: {r.get('discharge_m3s', 'N/A')} m³/s"
        )
    return "\n\n".join(lines)


def _build_terrain_context(terrain: dict) -> str:
    if not terrain:
        return "No terrain data available."
    demo = "[DEMO DATA] " if terrain.get("is_demo") else ""
    return (
        f"{demo}Elevation: {terrain.get('elevation_m', 'N/A')} m\n"
        f"Slope: {terrain.get('slope_degrees', 'N/A')}°  Aspect: {terrain.get('aspect', 'N/A')}\n"
        f"Land Cover: {terrain.get('land_cover', 'N/A')}\n"
        f"Soil Type: {terrain.get('soil_type', 'N/A')}\n"
        f"Flood Plain Probability: {terrain.get('flood_plain_probability', 'N/A')}"
    )


def _build_rag_context(chunks: list) -> str:
    if not chunks:
        return "No relevant documents found in the knowledge base."
    parts = []
    for i, chunk in enumerate(chunks[:6], 1):
        src = chunk.get("metadata", {}).get("document", "Unknown document")
        relevance = chunk.get("relevance_label", "")
        parts.append(f"[{i}] [{relevance}] Source: {src}\n{chunk.get('text', '')[:500]}")
    return "\n\n".join(parts)


class ResponseAgent:
    def __init__(self):
        self.qwen = QwenClient()
        self.pred = PredictionAgent()

    async def generate_response(self, query: str, ctx: dict) -> QueryResponse:
        """
        Agentic loop: up to MAX_AGENT_ITERATIONS.
        On each iteration, build context → call Qwen → check sufficiency.
        """
        iterations = 0
        answer = ""
        risk, conf, reasons, evidence, actions = self.pred.analyze_risk(ctx)

        for iteration in range(1, MAX_AGENT_ITERATIONS + 1):
            iterations = iteration

            system_prompt, user_prompt = self._build_prompts(query, ctx, risk, conf, reasons)
            answer = await self.qwen.generate_text(user_prompt, system_prompt)

            # Check if answer is sufficient or needs more context
            low_info_signals = [
                "insufficient data",
                "no data available",
                "unavailable",
                "cannot determine",
                "no sensor",
                "no weather",
            ]
            needs_more = any(sig in answer.lower() for sig in low_info_signals)

            if not needs_more or iteration == MAX_AGENT_ITERATIONS:
                break

            # Expand context on next iteration: add terrain if missing, expand RAG
            if not ctx.get("terrain"):
                from app.data.terrain import TerrainService
                ctx["terrain"] = TerrainService().get_terrain(ctx.get("lat", 0), ctx.get("lng", 0))
            if not ctx.get("weather"):
                from app.data.weather import WeatherService
                ctx["weather"] = WeatherService().get_weather(ctx.get("lat", 0), ctx.get("lng", 0))

        # Build structured sources list
        sources = list({
            c.get("metadata", {}).get("document", "Unknown")
            for c in ctx.get("rag_chunks", [])
            if c.get("metadata", {}).get("document")
        })

        # Build sensor dicts for response
        sensor_dicts = [
            s.model_dump(mode="json") for s in ctx.get("sensors", [])
        ]

        # Determine missing data
        missing = []
        if not ctx.get("sensors"):
            missing.append("No sensors found in radius")
        if not ctx.get("weather"):
            missing.append("Weather data unavailable")
        if not ctx.get("river"):
            missing.append("River level data unavailable")
        if not ctx.get("rag_chunks"):
            missing.append("No relevant documents in knowledge base")

        location_info = ctx.get("location", {})

        return QueryResponse(
            query=query,
            location={
                "latitude": ctx.get("lat", 0),
                "longitude": ctx.get("lng", 0),
                "area": location_info.get("place_name", ""),
                "district": location_info.get("district", ""),
                "state": location_info.get("state", ""),
            },
            risk_level=risk,
            confidence=conf,
            answer=answer,
            sensors=sensor_dicts,
            evidence=evidence,
            sources=sources,
            recommended_actions=actions,
            missing_data=missing,
            agent_iterations=iterations,
            timestamp=datetime.now(timezone.utc),
        )

    async def stream_response(self, query: str, ctx: dict) -> AsyncGenerator[str, None]:
        """Streaming version — yields Qwen tokens."""
        risk, conf, reasons, evidence, actions = self.pred.analyze_risk(ctx)
        system_prompt, user_prompt = self._build_prompts(query, ctx, risk, conf, reasons)
        async for chunk in self.qwen.generate_text_stream(user_prompt, system_prompt):
            yield chunk

    def _build_prompts(
        self, query: str, ctx: dict, risk: str, conf: float, reasons: list
    ) -> tuple[str, str]:
        location_info = ctx.get("location", {})
        lat = ctx.get("lat", 0)
        lng = ctx.get("lng", 0)
        area_name = (
            location_info.get("place_name")
            or location_info.get("district")
            or f"{lat:.4f}, {lng:.4f}"
        )

        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            latitude=lat,
            longitude=lng,
            area_name=area_name,
            sensor_context=_build_sensor_context(ctx.get("sensors", [])),
            weather_context=_build_weather_context(ctx.get("weather", {})),
            river_context=_build_river_context(ctx.get("river", [])),
            terrain_context=_build_terrain_context(ctx.get("terrain", {})),
            rag_context=_build_rag_context(ctx.get("rag_chunks", [])),
            risk_level=risk,
            confidence=conf,
            risk_reasons=", ".join(reasons) if reasons else "No specific triggers identified",
        )

        user_prompt = f"USER QUESTION:\n{query}"

        return system_prompt, user_prompt
