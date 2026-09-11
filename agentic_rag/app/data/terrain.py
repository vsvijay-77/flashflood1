class TerrainService:
    def get_terrain(self, lat: float, lng: float) -> dict:
        return {
            "elevation_m": 280,
            "slope_degrees": 5.2,
            "aspect": "South-West",
            "drainage_density": "high",
            "land_cover": "agriculture",
            "soil_type": "clay_loam",
            "flood_plain_probability": 0.85,
            "is_demo": True
        }
        # Replace with real SRTM/ASTER elevation + land cover APIs in production
        
    def summarize_for_context(self, terrain: dict) -> str:
        demo = "[DEMO DATA] " if terrain.get("is_demo") else ""
        return f"{demo}Elevation: {terrain['elevation_m']}m, Slope: {terrain['slope_degrees']} deg, Flood Prob: {terrain['flood_plain_probability']*100}%"
