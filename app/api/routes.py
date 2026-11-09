import hmac
import logging
import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Header
from pydantic import BaseModel, Field
from app.core.config import get_settings
from app.rag.workflow import ask
from app.rag.vectorstore import add_documents
from app.services.ingestion import load_file, chunk_documents, SUPPORTED
from app.services.audit import write_audit

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

settings = get_settings()

class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=3000)


@router.get("/health")
def health():
    return {"status": "ok", "service": settings.app_name}


@router.post("/chat")
def chat(payload: ChatRequest):
    try:
        result = ask(payload.question)
        write_audit(payload.question, result["source_used"], result.get("trace", []))
        return {
            "answer": result["answer"],
            "source_used": result["source_used"],
            "trace": result.get("trace", []),
            "citations": result.get("citations", []),
            "rewritten_query": result.get("current_query", payload.question),
        }
    except Exception as exc:
        logger.exception("Chat request failed")
        raise HTTPException(status_code=500, detail="Unable to process the request") from exc


@router.post("/ingest")
async def ingest(file: UploadFile = File(...), x_admin_key: str = Header(default="")):
    if not hmac.compare_digest(x_admin_key, settings.admin_api_key):
        raise HTTPException(status_code=401, detail="Invalid admin key")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(status_code=400, detail=f"Supported: {', '.join(sorted(SUPPORTED))}")
    max_upload_size = settings.max_upload_size_mb * 1024 * 1024
    content = await file.read(max_upload_size + 1)
    if len(content) > max_upload_size:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.max_upload_size_mb} MB upload limit",
        )
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    original_name = Path(file.filename or "upload").name
    dest = upload_dir / f"{uuid.uuid4().hex}{suffix}"
    dest.write_bytes(content)
    try:
        docs = load_file(dest)
        chunks = chunk_documents(docs)
        ids = add_documents(chunks)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        logger.exception("Document upload could not be indexed")
        raise HTTPException(
            status_code=400,
            detail="The uploaded document could not be read or indexed",
        ) from exc
    return {
        "message": "Document indexed",
        "file": original_name,
        "chunks": len(chunks),
        "ids_created": len(ids),
    }
