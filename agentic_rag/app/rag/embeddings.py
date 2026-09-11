from sentence_transformers import SentenceTransformer
import numpy as np
from app.config import settings
import threading

class EmbeddingEngine:
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(EmbeddingEngine, cls).__new__(cls)
                cls._instance._model = None
            return cls._instance
            
    def _load(self):
        if self._model is None:
            self._model = SentenceTransformer(settings.embedding_model)
            
    def encode(self, texts: list[str]) -> np.ndarray:
        self._load()
        return self._model.encode(texts)

def get_embedding_engine():
    return EmbeddingEngine()
