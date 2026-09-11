import asyncio
import os
import uuid
from typing import Optional
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

_supabase_client: Optional[Client] = None

def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SECRET_KEY", "")
        if not url or not key:
            # Fallback or empty client
            load_dotenv()
            url = os.environ.get("SUPABASE_URL", "")
            key = os.environ.get("SUPABASE_SECRET_KEY", "")
        _supabase_client = create_client(url, key)
    return _supabase_client

class _LazySupabaseProxy:
    def __getattr__(self, name):
        return getattr(get_supabase(), name)

supabase = _LazySupabaseProxy()

class AsyncCursor:
    def __init__(self, query):
        self.query = query

    def sort(self, field, direction):
        dr = False if direction == -1 else True
        self.query = self.query.order(f"data->{field}", desc=not dr)
        return self

    def limit(self, limit):
        self.query = self.query.limit(limit)
        return self

    async def to_list(self, length):
        if length:
            self.query = self.query.limit(length)
        try:
            res = await asyncio.wait_for(asyncio.to_thread(self.query.execute), timeout=5.0)
            return [row["data"] for row in res.data] if res.data else []
        except Exception:
            return []

class Collection:
    def __init__(self, name):
        self.name = name

    def _build_filter(self, query):
        q = supabase.table(self.name).select("*")
        for k, v in query.items():
            if k == "_id":
                continue # Ignore mongo ID
            if isinstance(v, dict):
                # e.g. {"$ne": "resolved"}
                if "$ne" in v:
                    q = q.neq(f"data->>{k}", v["$ne"])
                if "$in" in v:
                    q = q.in_(f"data->>{k}", v["$in"])
            else:
                q = q.eq(f"data->>{k}", v)
        return q

    def find(self, query=None, projection=None):
        query = query or {}
        q = self._build_filter(query)
        return AsyncCursor(q)

    async def find_one(self, query=None, projection=None):
        query = query or {}
        try:
            q = self._build_filter(query).limit(1)
            res = await asyncio.wait_for(asyncio.to_thread(q.execute), timeout=5.0)
            if res.data:
                return res.data[0]["data"]
        except Exception:
            pass
        return None

    async def count_documents(self, query=None):
        query = query or {}
        try:
            q = self._build_filter(query)
            res = await asyncio.wait_for(asyncio.to_thread(q.execute), timeout=5.0)
            return len(res.data) if res.data else 0
        except Exception:
            return 0


    async def insert_one(self, doc):
        doc_id = doc.get("id", str(uuid.uuid4()))
        doc["id"] = doc_id
        try:
            supabase.table(self.name).insert({"id": doc_id, "data": doc}).execute()
        except Exception as e:
            print(f"Database insert_one notice ({self.name}):", e)
        class Result:
            inserted_id = doc_id
        return Result()

    async def update_one(self, query, update):
        doc = await self.find_one(query)
        if not doc:
            return None
            
        new_data = doc.copy()
        if "$set" in update:
            new_data.update(update["$set"])
        if "$inc" in update:
            for k, inc_val in update["$inc"].items():
                new_data[k] = new_data.get(k, 0) + inc_val
        if "$unset" in update:
            for k in update["$unset"]:
                new_data.pop(k, None)
                
        try:
            supabase.table(self.name).update({"data": new_data}).eq("id", doc["id"]).execute()
        except Exception as e:
            print(f"Database update_one notice ({self.name}):", e)
        return None

    async def update_many(self, query, update):
        docs = await self.find(query).to_list(None)
        for d in docs:
            await self.update_one({"id": d["id"]}, update)
        return None

    async def delete_one(self, query):
        doc = await self.find_one(query)
        if doc:
            try:
                supabase.table(self.name).delete().eq("id", doc["id"]).execute()
            except Exception as e:
                print(f"Database delete_one notice ({self.name}):", e)
        return None

    async def delete_many(self, query):
        docs = await self.find(query).to_list(None)
        for d in docs:
            await self.delete_one({"id": d["id"]})
        return None

class Database:
    def __getattr__(self, name):
        return Collection(name)

db = Database()
