import httpx
import asyncio

async def seed():
    sensors = [
        {"sensor_id": "RAIN_001", "sensor_type": "rainfall", "rainfall_mm": 55.0},
        {"sensor_id": "RIVER_001", "sensor_type": "water_level", "water_level_m": 4.5},
        {"sensor_id": "SOIL_001", "sensor_type": "soil_moisture", "soil_moisture": 0.88},
        {"sensor_id": "TEMP_001", "sensor_type": "temperature", "temperature_c": 29.0},
        {"sensor_id": "GAUGE_001", "sensor_type": "river_gauge", "water_level_m": 4.2}
    ]
    
    async with httpx.AsyncClient() as client:
        for s in sensors:
            data = {
                "sensor_id": s["sensor_id"],
                "latitude": 10.6608,
                "longitude": 77.0048,
                "sensor_type": s["sensor_type"],
                "is_demo": True,
                **s
            }
            await client.post("http://localhost:8002/sensors/update", json=data)
            
    print("DEMO DATA seeded successfully")

if __name__ == "__main__":
    asyncio.run(seed())
