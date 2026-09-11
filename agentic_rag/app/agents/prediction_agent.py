class PredictionAgent:
    def analyze_risk(self, ctx: dict) -> tuple[str, float, list, list, list]:
        reasons = []
        evidence = []
        actions = []
        
        max_rain = 0.0
        max_water_lvl = 0.0
        max_soil = 0.0
        
        for s in ctx.get('sensors', []):
            max_rain = max(max_rain, s.rainfall_mm)
            max_water_lvl = max(max_water_lvl, s.water_level_m)
            max_soil = max(max_soil, s.soil_moisture)
            
        w_rain = ctx.get('weather', {}).get('precipitation_mm_1h', 0)
        max_rain = max(max_rain, w_rain)
        
        river_trend = ""
        river_danger = False
        river_warning = False
        for r in ctx.get('river', []):
            if r['water_level_m'] > r['danger_level_m']:
                river_danger = True
            elif r['water_level_m'] > r['warning_level_m']:
                river_warning = True
            if r['trend'] == 'rising':
                river_trend = 'rising'
                
        if river_danger or max_rain > 100 or (river_trend == 'rising' and river_warning):
            risk = "CRITICAL"
            conf = 90.0
            reasons.append("Extreme water levels or rainfall detected.")
            actions = ["evacuation warnings", "alert authorities", "avoid low-lying areas"]
        elif max_rain >= 50 or river_warning or max_soil > 0.85:
            risk = "HIGH"
            conf = 85.0
            reasons.append("High rainfall or warning water levels.")
            actions = ["stay alert", "prepare emergency kit", "monitor official updates"]
        elif max_rain >= 25 or max_soil > 0.7:
            risk = "MODERATE"
            conf = 75.0
            reasons.append("Moderate rainfall or elevated soil moisture.")
            actions = ["monitor conditions", "check drainage", "stay informed"]
        else:
            risk = "LOW"
            conf = 95.0
            reasons.append("Normal conditions.")
            actions = ["normal precautions"]
            
        evidence.append("This is a rule-based assessment, not a certified scientific prediction.")
        
        return risk, conf, reasons, evidence, actions
