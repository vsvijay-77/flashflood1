from app.data.sensors import SensorStore

class SensorAgent:
    def __init__(self):
        self.store = SensorStore()
        
    def process(self, lat: float, lng: float, radius: float) -> tuple[list, list, str, str]:
        sensors = self.store.get_nearby_sensors(lat, lng, radius)
        abnormal = self.store.get_abnormal_sensors(lat, lng, radius)
        ctx = self.store.summarize_for_context(sensors)
        alert_level = "HIGH" if len(abnormal) > 0 else "NORMAL"
        return sensors, abnormal, ctx, alert_level
