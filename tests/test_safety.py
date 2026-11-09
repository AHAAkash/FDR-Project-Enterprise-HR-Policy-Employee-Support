import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services import audit


class ProductionSettingsTests(unittest.TestCase):
    def test_production_rejects_default_admin_key(self):
        with self.assertRaises(ValueError):
            Settings(app_env="production", admin_api_key="change-me-in-production")

    def test_production_accepts_long_admin_key(self):
        settings = Settings(app_env="production", admin_api_key="a" * 40)
        self.assertEqual(settings.app_env, "production")


class VectorStoreSafetyTests(unittest.TestCase):
    def test_dimension_mismatch_does_not_delete_or_recreate_index(self):
        from app.rag import vectorstore

        pinecone = unittest.mock.Mock()
        pinecone.list_indexes.return_value = [{"name": "hr-index"}]
        pinecone.describe_index.return_value = {"dimension": 1536}
        config = SimpleNamespace(
            pinecone_api_key="test-key",
            pinecone_index_name="hr-index",
            embedding_model="text-embedding-3-large",
        )

        with (
            patch.object(vectorstore, "Pinecone", return_value=pinecone),
            patch.object(vectorstore, "settings", config),
        ):
            with self.assertRaisesRegex(RuntimeError, "existing index was not changed"):
                vectorstore.ensure_index()

        pinecone.delete_index.assert_not_called()
        pinecone.create_index.assert_not_called()


class AuditPrivacyTests(unittest.TestCase):
    def test_questions_are_redacted_and_expired_audits_are_removed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = str(Path(temp_dir) / "audit.db")
            config = SimpleNamespace(
                audit_db_path=db_path,
                audit_retention_days=90,
                audit_store_questions=False,
            )
            with patch.object(audit, "settings", config):
                audit.init_db()
                with closing(sqlite3.connect(db_path)) as con:
                    with con:
                        con.execute(
                            "INSERT INTO query_audit(created_at, question, source_used, trace_json) "
                            "VALUES (?, ?, ?, ?)",
                            ("2000-01-01T00:00:00+00:00", "old question", "direct", "[]"),
                        )

                audit.init_db()
                audit.write_audit("private employee question", "direct", [])
                with closing(sqlite3.connect(db_path)) as con:
                    rows = con.execute(
                        "SELECT question FROM query_audit ORDER BY id"
                    ).fetchall()

        self.assertEqual(rows, [("[redacted]",)])


class ApiSafetyTests(unittest.TestCase):
    def test_chat_errors_do_not_expose_exception_details(self):
        from app.api import routes

        test_app = FastAPI()
        test_app.include_router(routes.router)
        with (
            patch.object(routes, "ask", side_effect=RuntimeError("secret backend detail")),
            patch.object(routes, "write_audit"),
            TestClient(test_app) as client,
        ):
            response = client.post("/api/chat", json={"question": "hello"})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "Unable to process the request")

    def test_upload_rejects_files_over_configured_limit(self):
        from app.api import routes

        test_app = FastAPI()
        test_app.include_router(routes.router)
        config = SimpleNamespace(admin_api_key="test-key", max_upload_size_mb=1)
        with (
            patch.object(routes, "settings", config),
            TestClient(test_app) as client,
        ):
            response = client.post(
                "/api/ingest",
                headers={"X-Admin-Key": "test-key"},
                files={"file": ("large.txt", b"a" * (1024 * 1024 + 1), "text/plain")},
            )

        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
