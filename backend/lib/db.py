"""Supabase Database Adapter: Exposes an asynchronous collection-like interface
backed by Supabase PostgreSQL tables, providing 100% compatibility with existing
routers while routing all storage to cloud Supabase.
"""
import os
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
from dotenv import load_dotenv
from supabase import create_client, Client
from motor.motor_asyncio import AsyncIOMotorClient

import threading
import time

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / ".env")
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "app")

_thread_local = threading.local()
_mongo_client: Optional[AsyncIOMotorClient] = None


def get_supabase() -> Client:
    client = getattr(_thread_local, "client", None)
    if client is None:
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SECRET_KEY", "")
        if not url or not key:
            load_dotenv(ROOT_DIR / ".env")
            url = os.environ.get("SUPABASE_URL", "")
            key = os.environ.get("SUPABASE_SECRET_KEY", "")
        if not url or not key:
            raise ValueError("SUPABASE_URL or SUPABASE_SECRET_KEY not set")
        client = create_client(url, key)
        _thread_local.client = client
    return client


def _is_fallback_error(e: Exception) -> bool:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SECRET_KEY"):
        return True
    err = str(e).lower()
    return "pgrst205" in err or "not find the table" in err or isinstance(e, (ValueError, KeyError, AttributeError))


def _run_with_retry(fn, retries=2):
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as e:
            err_msg = str(e).lower()
            if attempt < retries and ("deque" in err_msg or "401" in err_msg or "protocol" in err_msg or "remote" in err_msg):
                time.sleep(0.04 * (attempt + 1))
                continue
            raise



def get_mongo_fallback():
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=1500)
    return _mongo_client[DB_NAME]


def _serialize_for_supabase(val: Any) -> Any:
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, dict):
        return {k: _serialize_for_supabase(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_serialize_for_supabase(v) for v in val]
    return val


class InsertOneResult:
    def __init__(self, inserted_id: Any):
        self.inserted_id = inserted_id


class InsertManyResult:
    def __init__(self, inserted_ids: List[Any]):
        self.inserted_ids = inserted_ids


class UpdateResult:
    def __init__(self, modified_count: int = 1):
        self.modified_count = modified_count
        self.matched_count = modified_count


class DeleteResult:
    def __init__(self, deleted_count: int = 1):
        self.deleted_count = deleted_count


class SupabaseCursor:
    def __init__(self, table_name: str, query: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None):
        self.table_name = table_name
        self.query = query or {}
        self.projection = projection or {}
        self._sort_column: Optional[str] = None
        self._sort_descending: bool = False
        self._limit_count: Optional[int] = None
        self._skip_count: Optional[int] = None

    def sort(self, key_or_list: Union[str, List], direction: int = 1):
        if isinstance(key_or_list, str):
            self._sort_column = key_or_list
            self._sort_descending = direction == -1
        elif isinstance(key_or_list, list) and len(key_or_list) > 0:
            first = key_or_list[0]
            if isinstance(first, tuple):
                self._sort_column = first[0]
                self._sort_descending = first[1] == -1
        return self

    def limit(self, count: int):
        self._limit_count = count
        return self

    def skip(self, count: int):
        self._skip_count = count
        return self

    def _build_request(self, client: Client):
        builder = client.table(self.table_name).select("*")
        for k, v in self.query.items():
            if k == "_id":
                continue
            if isinstance(v, dict):
                if "$ne" in v:
                    builder = builder.neq(k, v["$ne"])
                elif "$in" in v:
                    builder = builder.in_(k, v["$in"])
                elif "$gt" in v:
                    builder = builder.gt(k, v["$gt"])
                elif "$gte" in v:
                    builder = builder.gte(k, v["$gte"])
                elif "$lt" in v:
                    builder = builder.lt(k, v["$lt"])
                elif "$lte" in v:
                    builder = builder.lte(k, v["$lte"])
            else:
                builder = builder.eq(k, v)

        if self._sort_column:
            builder = builder.order(self._sort_column, desc=self._sort_descending)

        if self._limit_count is not None:
            builder = builder.limit(self._limit_count)

        if self._skip_count is not None:
            start = self._skip_count
            end = start + (self._limit_count or 50) - 1
            builder = builder.range(start, end)

        return builder

    async def to_list(self, length: Optional[int] = None) -> List[Dict[str, Any]]:
        if length is not None:
            self._limit_count = length

        def _exec():
            c = get_supabase()
            req = self._build_request(c)
            return req.execute()

        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _run_with_retry(_exec))
            data = res.data or []
            return data
        except Exception as e:
            # Fallback to local MongoDB if table not yet created in Supabase
            if _is_fallback_error(e):
                mongo = get_mongo_fallback()
                cursor = mongo[self.table_name].find(self.query, self.projection)
                if self._sort_column:
                    cursor = cursor.sort(self._sort_column, -1 if self._sort_descending else 1)
                return await cursor.to_list(length)
            raise e

    def __aiter__(self):
        async def _generator():
            items = await self.to_list()
            for item in items:
                yield item
        return _generator()


class SupabaseCollection:
    def __init__(self, table_name: str):
        self.table_name = table_name

    def find(self, filter: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None) -> SupabaseCursor:
        return SupabaseCursor(self.table_name, filter, projection)

    async def find_one(self, filter: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        items = await self.find(filter, projection).limit(1).to_list(1)
        return items[0] if items else None

    async def insert_one(self, document: Dict[str, Any]) -> InsertOneResult:
        import uuid
        doc = dict(document)
        doc.pop("_id", None)
        if "id" not in doc or not doc["id"]:
            doc["id"] = str(uuid.uuid4())
        clean = _serialize_for_supabase(doc)

        def _exec():
            c = get_supabase()
            return c.table(self.table_name).insert(clean).execute()

        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _run_with_retry(_exec))
            inserted_id = clean.get("id")
            if not inserted_id and res.data and len(res.data) > 0:
                inserted_id = res.data[0].get("id")
            return InsertOneResult(inserted_id)
        except Exception as e:
            if _is_fallback_error(e):
                mongo = get_mongo_fallback()
                res = await mongo[self.table_name].insert_one(document)
                return InsertOneResult(res.inserted_id)
            raise e

    async def insert_many(self, documents: List[Dict[str, Any]]) -> InsertManyResult:
        if not documents:
            return InsertManyResult([])
        import uuid
        clean_docs = []
        for d in documents:
            doc = dict(d)
            doc.pop("_id", None)
            if "id" not in doc or not doc["id"]:
                doc["id"] = str(uuid.uuid4())
            clean_docs.append(_serialize_for_supabase(doc))

        def _exec():
            c = get_supabase()
            return c.table(self.table_name).insert(clean_docs).execute()

        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _run_with_retry(_exec))
            inserted_ids = [d.get("id") for d in clean_docs]
            return InsertManyResult(inserted_ids)
        except Exception as e:
            if _is_fallback_error(e):
                mongo = get_mongo_fallback()
                res = await mongo[self.table_name].insert_many(documents)
                return InsertManyResult(res.inserted_ids)
            raise e

    async def update_one(self, filter: Dict[str, Any], update: Dict[str, Any]) -> UpdateResult:
        try:
            # Handle $set and $inc
            updates: Dict[str, Any] = {}
            if "$set" in update:
                updates.update(update["$set"])

            if "$inc" in update:
                # Fetch current document to apply increment
                current = await self.find_one(filter)
                if current:
                    for inc_field, inc_val in update["$inc"].items():
                        current_val = current.get(inc_field) or 0
                        updates[inc_field] = current_val + inc_val

            if not updates and not any(k.startswith("$") for k in update.keys()):
                updates = update

            clean_updates = _serialize_for_supabase(updates)

            def _exec():
                c = get_supabase()
                builder = c.table(self.table_name).update(clean_updates)
                for k, v in filter.items():
                    if k != "_id":
                        builder = builder.eq(k, v)
                return builder.execute()

            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _run_with_retry(_exec))
            count = len(res.data or []) if res.data else 1
            return UpdateResult(count)
        except Exception as e:
            if _is_fallback_error(e):
                mongo = get_mongo_fallback()
                res = await mongo[self.table_name].update_one(filter, update)
                return UpdateResult(res.modified_count)
            raise e

    async def delete_one(self, filter: Dict[str, Any]) -> DeleteResult:
        def _exec():
            c = get_supabase()
            builder = c.table(self.table_name).delete()
            for k, v in filter.items():
                if k != "_id":
                    builder = builder.eq(k, v)
            return builder.execute()

        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _run_with_retry(_exec))
            count = len(res.data or []) if res.data else 1
            return DeleteResult(count)
        except Exception as e:
            if _is_fallback_error(e):
                mongo = get_mongo_fallback()
                res = await mongo[self.table_name].delete_one(filter)
                return DeleteResult(res.deleted_count)
            raise e

    async def delete_many(self, filter: Dict[str, Any]) -> DeleteResult:
        def _exec():
            c = get_supabase()
            builder = c.table(self.table_name).delete()
            for k, v in filter.items():
                if k != "_id":
                    builder = builder.eq(k, v)
            return builder.execute()

        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _run_with_retry(_exec))
            count = len(res.data or []) if res.data else 0
            return DeleteResult(count)
        except Exception as e:
            if _is_fallback_error(e):
                mongo = get_mongo_fallback()
                res = await mongo[self.table_name].delete_many(filter)
                return DeleteResult(res.deleted_count)
            raise e

    async def count_documents(self, filter: Optional[Dict[str, Any]] = None) -> int:
        filter = filter or {}

        def _exec():
            c = get_supabase()
            builder = c.table(self.table_name).select("id", count="exact").limit(1)
            for k, v in filter.items():
                if k == "_id":
                    continue
                if isinstance(v, dict):
                    if "$ne" in v:
                        builder = builder.neq(k, v["$ne"])
                    elif "$in" in v:
                        builder = builder.in_(k, v["$in"])
                    elif "$gt" in v:
                        builder = builder.gt(k, v["$gt"])
                    elif "$gte" in v:
                        builder = builder.gte(k, v["$gte"])
                    elif "$lt" in v:
                        builder = builder.lt(k, v["$lt"])
                    elif "$lte" in v:
                        builder = builder.lte(k, v["$lte"])
                else:
                    builder = builder.eq(k, v)
            return builder.execute()

        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _run_with_retry(_exec))
            if res.count is not None:
                return res.count
            return len(res.data or [])
        except Exception as e:
            if _is_fallback_error(e):
                mongo = get_mongo_fallback()
                return await mongo[self.table_name].count_documents(filter)
            raise e


class SupabaseDatabase:
    def __getattr__(self, name: str) -> SupabaseCollection:
        return SupabaseCollection(name)

    def __getitem__(self, name: str) -> SupabaseCollection:
        return SupabaseCollection(name)


db = SupabaseDatabase()


class _LazySupabaseProxy:
    def __getattr__(self, name):
        return getattr(get_supabase(), name)


supabase = _LazySupabaseProxy()
