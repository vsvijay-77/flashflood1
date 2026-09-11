from app.data.location import LocationService

class LocationAgent:
    def __init__(self):
        self.svc = LocationService()
        
    def process(self, lat: float, lng: float) -> tuple[dict, str]:
        info = self.svc.get_location_info(lat, lng)
        ctx = f"Location: {info['place_name']}, {info['district']}, {info['state']}, {info['country']} (Lat: {info['latitude']}, Lng: {info['longitude']})"
        return info, ctx
