"""
FAISS Vector Store — stores embeddings with chunk text and metadata.
Persists to disk so the index survives server restarts.
"""
import json
import numpy as np
import faiss
from pathlib import Path
from typing import Optional

from app.config import settings
from app.rag.embeddings import get_embedding_engine
from app.data.location import LocationService


class FAISSVectorStore:
    """
    Stores (embedding, chunk_text, metadata) triples.
    - FAISS index holds the float32 embedding vectors.
    - A parallel JSON file holds {text, metadata} for each vector (same index).
    """

    def __init__(self):
        self.index_path = Path(settings.faiss_index_path)
        self.meta_path = self.index_path.with_suffix(".meta.json")
        self.dim = 384  # all-MiniLM-L6-v2 output dimension
        self.index: Optional[faiss.Index] = None
        # Each entry: {"text": str, "metadata": dict}
        self.chunks: list[dict] = []
        self._loc_service = LocationService()
        self.load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def load(self):
        """Load existing FAISS index + chunk metadata from disk."""
        if self.index_path.exists() and self.meta_path.exists():
            try:
                self.index = faiss.read_index(str(self.index_path))
                with open(self.meta_path, "r") as f:
                    self.chunks = json.load(f)
                return
            except Exception as e:
                print(f"⚠️  FAISS load failed ({e}), starting fresh.")
        self._init_empty_index()

    def save(self):
        """Persist FAISS index + metadata to disk."""
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self.index, str(self.index_path))
        with open(self.meta_path, "w") as f:
            json.dump(self.chunks, f, ensure_ascii=False)

    def _init_empty_index(self):
        self.index = faiss.IndexFlatIP(self.dim)  # Inner-product (cosine after normalize)
        self.chunks = []

    # ── Write ─────────────────────────────────────────────────────────────────

    def add_chunks(self, chunks: list[dict]):
        """
        Add chunks to the vector store.
        Each chunk: {"text": str, "metadata": dict}
        """
        if not chunks:
            return
        engine = get_embedding_engine()
        texts = [c["text"] for c in chunks]
        embs = engine.encode(texts)
        # Normalize for cosine similarity via inner product
        norms = np.linalg.norm(embs, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        embs_normalized = (embs / norms).astype("float32")
        self.index.add(embs_normalized)
        self.chunks.extend(
            {"text": c["text"], "metadata": c.get("metadata", {})} for c in chunks
        )
        self.save()
        print(f"✅ Added {len(chunks)} chunks. Total: {self.index.ntotal}")

    def delete_document(self, document_id: str) -> int:
        """
        Remove all chunks for a given document_id.
        Rebuilds the FAISS index without those chunks.
        Returns number of chunks removed.
        """
        keep = [
            c for c in self.chunks
            if c.get("metadata", {}).get("document_id") != document_id
        ]
        removed = len(self.chunks) - len(keep)
        if removed == 0:
            return 0

        # Rebuild index
        self._init_empty_index()
        if keep:
            engine = get_embedding_engine()
            texts = [c["text"] for c in keep]
            embs = engine.encode(texts)
            norms = np.linalg.norm(embs, axis=1, keepdims=True)
            norms = np.where(norms == 0, 1, norms)
            embs_normalized = (embs / norms).astype("float32")
            self.index.add(embs_normalized)
            self.chunks = keep
        else:
            self.chunks = []
        self.save()
        return removed

    # ── Read ──────────────────────────────────────────────────────────────────

    def search(
        self,
        query_text: str,
        k: int = 6,
        location_filter: Optional[dict] = None,
    ) -> list[dict]:
        """
        Retrieve top-k most similar chunks for query_text.
        Optionally boosts chunks geographically close to location_filter.
        Returns list of {text, metadata, score}.
        """
        if self.index is None or self.index.ntotal == 0:
            return []

        engine = get_embedding_engine()
        q_emb = engine.encode([query_text])
        norm = np.linalg.norm(q_emb, axis=1, keepdims=True)
        norm = np.where(norm == 0, 1, norm)
        q_emb_normalized = (q_emb / norm).astype("float32")

        # Retrieve 2× to allow re-ranking
        fetch_k = min(k * 2, self.index.ntotal)
        D, I = self.index.search(q_emb_normalized, fetch_k)

        results = []
        for score, idx in zip(D[0], I[0]):
            if idx < 0 or idx >= len(self.chunks):
                continue
            chunk = self.chunks[idx]
            meta = chunk.get("metadata", {})
            sim = float(score)  # already cosine similarity [-1, 1]

            # Geo boost
            if location_filter and meta.get("location_lat") and meta.get("location_lng"):
                lat = location_filter.get("latitude", 0)
                lng = location_filter.get("longitude", 0)
                radius = location_filter.get("radius_km", 50)
                if lat and lng:
                    dist_km = self._loc_service.haversine_distance_km(
                        lat, lng, meta["location_lat"], meta["location_lng"]
                    )
                    if dist_km <= radius:
                        sim = min(1.0, sim + 0.15)

            results.append({"text": chunk["text"], "metadata": meta, "score": sim})

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:k]

    def get_document_list(self) -> list[dict]:
        """Return a summary of all indexed documents."""
        docs: dict[str, dict] = {}
        for chunk in self.chunks:
            meta = chunk.get("metadata", {})
            doc_id = meta.get("document_id", "unknown")
            if doc_id not in docs:
                docs[doc_id] = {
                    "document_id": doc_id,
                    "filename": meta.get("document", ""),
                    "file_type": Path(meta.get("document", "")).suffix,
                    "chunk_count": 0,
                    "topics": set(),
                    "locations": [],
                    "status": "processed",
                }
            docs[doc_id]["chunk_count"] += 1
            if meta.get("topic"):
                if isinstance(meta["topic"], list):
                    docs[doc_id]["topics"].update(meta["topic"])
                else:
                    docs[doc_id]["topics"].add(str(meta["topic"]))

        result = []
        for v in docs.values():
            v["topics"] = list(v["topics"])
            result.append(v)
        return result
