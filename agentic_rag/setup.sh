cd /Users/vijay/Documents/flash_flood/agentic_rag
python3 -m venv venv
source venv/bin/activate
pip install pydantic-settings
pip install -r requirements.txt
echo "--- CONFIG TEST ---"
python -c "from app.config import settings; print('Config OK:', settings.qwen_api_url)"
echo "--- EMBEDDINGS TEST ---"
python -c "from app.rag.embeddings import get_embedding_engine; e = get_embedding_engine(); print('Embeddings OK:', e.encode(['test']).shape)"
echo "--- STARTING SERVER ---"
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload > uvicorn.log 2>&1 &
SERVER_PID=$!
sleep 10
echo "--- HEALTH CHECK ---"
curl -s http://localhost:8002/health | python3 -m json.tool
echo "--- SEED DEMO DATA ---"
python seed_demo_data.py
echo "--- QUERY TEST ---"
curl -s -X POST http://localhost:8002/query -H 'Content-Type: application/json' -d '{"query": "What is the flood risk?", "latitude": 10.6608, "longitude": 77.0048, "radius_km": 10}' | python3 -m json.tool
kill $SERVER_PID
