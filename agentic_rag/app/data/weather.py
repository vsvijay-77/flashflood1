class WeatherService:
    def get_weather(self, lat: float, lng: float) -> dict:
        return {
            "temperature_c": 28.5,
            "humidity_pct": 82,
            "pressure_hpa": 1008,
            "wind_speed_kmh": 15,
            "wind_direction": "SW",
            "precipitation_mm_1h": 12.5,
            "precipitation_mm_24h": 45.0,
            "weather_condition": "Heavy Rain",
            "forecast_24h": "Continuous heavy rainfall expected",
            "data_source": "MockWeather API",
            "is_demo": True
        }
        # Replace with real weather API (OpenWeatherMap, IMD, etc.) in production
        
    def summarize_for_context(self, weather: dict) -> str:
        demo = "[DEMO DATA] " if weather.get("is_demo") else ""
        return f"{demo}Condition: {weather['weather_condition']}, Temp: {weather['temperature_c']}C, Rain(1h): {weather['precipitation_mm_1h']}mm"
