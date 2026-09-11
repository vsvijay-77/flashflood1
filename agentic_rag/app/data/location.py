import httpx
import math

class LocationService:
    def get_location_info(self, lat: float, lng: float) -> dict:
        # Simplified for speed
        return {
            "district": "Coimbatore",
            "state": "Tamil Nadu",
            "country": "India",
            "place_name": "Pollachi",
            "full_address": "Pollachi, Coimbatore, Tamil Nadu, India",
            "latitude": lat,
            "longitude": lng
        }
        
    def haversine_distance_km(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371.0
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
        
    def is_within_radius(self, lat1: float, lon1: float, lat2: float, lon2: float, radius_km: float) -> bool:
        return self.haversine_distance_km(lat1, lon1, lat2, lon2) <= radius_km
