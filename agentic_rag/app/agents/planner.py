class QueryPlanner:
    def plan(self, query: str) -> dict:
        q = query.lower()
        res = {
            "needs_documents": False,
            "needs_sensors": False,
            "needs_weather": False,
            "needs_river": False,
            "needs_terrain": False,
            "needs_location": True,
            "needs_image": False,
            "query_type": "general",
            "priority_topics": []
        }
        
        if any(k in q for k in ['risk', 'flood', 'danger', 'alert', 'warning', 'level', 'threshold']):
            res['query_type'] = 'risk_assessment'
            res['needs_sensors'] = True
            res['needs_weather'] = True
            res['needs_river'] = True
            res['needs_terrain'] = True
            res['needs_documents'] = True
        elif any(k in q for k in ['sensor', 'reading', 'measurement', 'deployed', 'monitoring']):
            res['query_type'] = 'sensor_query'
            res['needs_sensors'] = True
            res['needs_documents'] = True
        elif any(k in q for k in ['procedure', 'protocol', 'evacuation', 'what should', 'action', 'response']):
            res['query_type'] = 'procedure_query'
            res['needs_documents'] = True
            res['needs_river'] = True
            res['needs_sensors'] = True
        else:
            res['needs_documents'] = True
            
        return res
