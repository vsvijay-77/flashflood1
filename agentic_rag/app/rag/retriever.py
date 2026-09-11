"""
RAG Retriever — encodes query, searches FAISS, re-ranks results with location boosting.
"""
from typing import Optional
from app.rag.embeddings import get_embedding_engine
from app.rag.vector_store import FAISSVectorStore
from app.config import settings


class RAGRetriever:
    def __init__(self, vector_store: Optional[FAISSVectorStore] = None):
        self._vs = vector_store

    @property
    def vs(self) -> FAISSVectorStore:
        if self._vs is None:
            self._vs = FAISSVectorStore()
        return self._vs

    def retrieve(
        self,
        query: str,
        location_filter: Optional[dict] = None,
        k: Optional[int] = None,
    ) -> list[dict]:
        """
        Retrieve top-k chunks relevant to `query`.
        Optionally boost chunks matching the location filter.
        Returns list of {text, metadata, score, relevance_label}.
        """
        k = k or settings.max_retrieved_chunks

        if self.vs.index is None or self.vs.index.ntotal == 0:
            return []

        results = self.vs.search(query, k=k, location_filter=location_filter)

        # Re-rank: boost chunks mentioning location keywords
        if location_filter and results:
            loc_keywords = self._extract_location_keywords(location_filter)
            if loc_keywords:
                for r in results:
                    text_lower = r["text"].lower()
                    matches = sum(1 for kw in loc_keywords if kw in text_lower)
                    r["score"] = r["score"] + (matches * 0.05)
                results.sort(key=lambda x: x["score"], reverse=True)

        # Add relevance labels
        for r in results:
            score = r.get("score", 0)
            if score >= 0.70:
                r["relevance_label"] = "HIGH"
            elif score >= 0.50:
                r["relevance_label"] = "MEDIUM"
            else:
                r["relevance_label"] = "LOW"

        return results

    def _extract_location_keywords(self, loc_filter: dict) -> list[str]:
        """Extract searchable location keywords from the filter."""
        keywords = []
        if "place_name" in loc_filter:
            keywords.extend(loc_filter["place_name"].lower().split())
        if "district" in loc_filter:
            keywords.append(loc_filter["district"].lower())
        if "state" in loc_filter:
            keywords.append(loc_filter["state"].lower())
        return [k for k in keywords if len(k) > 2]

    def format_context(self, chunks: list[dict]) -> str:
        """Format retrieved chunks into a readable context string for the LLM."""
        if not chunks:
            return "No relevant documents retrieved."
        parts = []
        for i, chunk in enumerate(chunks, 1):
            meta = chunk.get("metadata", {})
            src = meta.get("document", "Unknown")
            rel = chunk.get("relevance_label", "")
            parts.append(f"[Doc {i}] [{rel}] {src}\n{chunk['text'][:600]}")
        return "\n\n".join(parts)
