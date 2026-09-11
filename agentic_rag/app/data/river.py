class RiverService:
    def get_river_data(self, lat: float, lng: float, radius_km: float) -> list[dict]:
        return [{
            "river_name": "Aliyar River",
            "station_name": "Pollachi Station",
            "water_level_m": 4.2,
            "danger_level_m": 5.0,
            "warning_level_m": 4.0,
            "normal_level_m": 2.5,
            "discharge_m3s": 150.0,
            "trend": "rising",
            "status": "warning",
            "latitude": 10.66,
            "longitude": 77.00,
            "is_demo": True
        }]
        # Replace with real CWC/state flood data APIs in production
        
    def summarize_for_context(self, rivers: list[dict]) -> str:
        if not rivers:
            return "No river data."
        res = []
        for r in rivers:
            d = "[DEMO DATA] " if r.get("is_demo") else ""
            res.append(f"{d}{r['river_name']} at {r['station_name']}: Level={r['water_level_m']}m (Warning: {r['warning_level_m']}m, Danger: {r['danger_level_m']}m), Trend: {r['trend']}")
        return "\n".join(res)
