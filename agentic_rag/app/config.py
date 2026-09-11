from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    qwen_api_url: str = "http://3.211.159.169:8000"
    max_upload_size_mb: int = 50
    embedding_model: str = "all-MiniLM-L6-v2"
    faiss_index_path: str = "documents/index/faiss.index"
    docs_upload_path: str = "documents/upload"
    docs_processed_path: str = "documents/processed"
    sensor_data_path: str = "data/sensors"
    historical_data_path: str = "data/historical"
    max_retrieved_chunks: int = 6
    max_tokens_default: int = 600
    cors_origins: str = "*"

settings = Settings()
