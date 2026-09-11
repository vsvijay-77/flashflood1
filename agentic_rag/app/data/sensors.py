import json
from pathlib import Path
from app.schemas.models import SensorReading
from app.config import settings
from app.data.location import LocationService

class SensorStore:
    def __init__(self):
        self.path = Path(settings.sensor_data_path) / 'sensors.json'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.sensors = {}
        self.loc_service = LocationService()
        self.load()
        
    def load(self):
        if self.path.exists():
            try:
                with open(self.path, 'r') as f:
                    data = json.load(f)
                    self.sensors = {k: SensorReading(**v) for k, v in data.items()}
            except:
                self.sensors = {}
                
    def save(self):
        with open(self.path, 'w') as f:
            json.dump({k: v.model_dump(mode='json') for k, v in self.sensors.items()}, f)
            
    def update_sensor(self, reading: SensorReading):
        self.sensors[reading.sensor_id] = reading
        self.save()
        
    def get_nearby_sensors(self, lat: float, lng: float, radius_km: float) -> list[SensorReading]:
        nearby = []
        for s in self.sensors.values():
            dist = self.loc_service.haversine_distance_km(lat, lng, s.latitude, s.longitude)
            if dist <= radius_km:
                nearby.append(s)
        return nearby
        
    def get_sensor_status(self, sensor_id: str) -> SensorReading | None:
        return self.sensors.get(sensor_id)
        
    def get_all_sensors(self) -> list[SensorReading]:
        return list(self.sensors.values())
        
    def get_abnormal_sensors(self, lat: float, lng: float, radius_km: float) -> list[SensorReading]:
        nearby = self.get_nearby_sensors(lat, lng, radius_km)
        abnormal = []
        for s in nearby:
            if s.rainfall_mm > s.threshold_rainfall and s.threshold_rainfall > 0:
                abnormal.append(s)
            elif s.water_level_m > s.threshold_water_level and s.threshold_water_level > 0:
                abnormal.append(s)
        return abnormal
        
    def summarize_for_context(self, sensors: list[SensorReading]) -> str:
        if not sensors:
            return "No sensor data available for this region."
        lines = []
        for s in sensors:
            demo_flag = "[DEMO DATA] " if s.is_demo else ""
            lines.append(f"- {demo_flag}{s.sensor_id} ({s.sensor_type}): Rain={s.rainfall_mm}mm, WaterLvl={s.water_level_m}m, SoilMoist={s.soil_moisture}")
        return "\n".join(lines)
