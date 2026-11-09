from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, model_validator
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Enterprise HR Policy Agentic RAG Copilot"
    app_env: str = "development"
    openai_api_key: str = ""
    tavily_api_key: str = ""
    pinecone_api_key: str = ""
    pinecone_index_name: str = "fde-hr-policy-rag"
    pinecone_namespace: str = "company-hr-kb"
    embedding_model: str = "text-embedding-3-small"
    openai_model: str = "gpt-4o-mini"
    top_k: int = 4
    max_retries: int = 1
    admin_api_key: str = "change-me-in-production"
    audit_store_questions: bool = False
    audit_retention_days: int = Field(default=90, gt=0)
    max_upload_size_mb: int = Field(default=10, gt=0)
    audit_db_path: str = str(BASE_DIR / "data" / "audit.db")
    upload_dir: str = str(BASE_DIR / "uploads")
    sample_kb_dir: str = str(BASE_DIR / "data" / "sample_kb")
    model_config = SettingsConfigDict(env_file=str(BASE_DIR / ".env"), extra="ignore")

    @model_validator(mode="after")
    def validate_production_secrets(self):
        if self.app_env.lower() == "production" and (
            self.admin_api_key == "change-me-in-production"
            or len(self.admin_api_key) < 32
        ):
            raise ValueError(
                "ADMIN_API_KEY must be configured with at least 32 characters in production"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()