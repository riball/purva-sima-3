"""Test isolation for storage.

Default: ALWAYS use the local-file backend, even if a developer has DATABASE_URL
set in backend/.env pointing at Supabase -- tests must never touch that database.
Individual tests redirect company_store.COMPANIES_DIR to a pytest tmp_path; the file
backend follows it.

Optional: set SIMA_TEST_DATABASE_URL to run the whole suite against a THROWAWAY
Postgres database instead (the `documents` table is created and emptied before
each test -- never point this at real data):

    SIMA_TEST_DATABASE_URL=postgresql://user:pw@localhost:5432/simatest pytest
"""
import os
from pathlib import Path

import pytest

from app.services import company_store, doc_store

_TEST_DB = os.getenv("SIMA_TEST_DATABASE_URL", "")
_pg = None


def _get_pg():
    global _pg
    if _pg is None:
        _pg = doc_store.PostgresBackend(_TEST_DB)
        schema = (Path(__file__).resolve().parent.parent / "db" / "schema.sql").read_text()
        with _pg._pool.connection() as conn:
            conn.execute(schema)
    return _pg


# These tests exercise real on-disk files (a hand-written legacy file, the shipped
# master item codes), so they only make sense with file storage.
_FILE_ONLY = {"test_pre_workstream_11_project_file_loads_without_a_project_name",
              "test_wo_carbon_api_rejects_pdf_with_no_extractable_text"}


@pytest.fixture(autouse=True)
def _storage_backend(request):
    prev = company_store._backend
    if _TEST_DB and request.node.name in _FILE_ONLY:
        pytest.skip("needs file storage")
    if _TEST_DB:
        pg = _get_pg()
        pg._q("truncate table documents")
        company_store.set_backend(pg)
    else:
        company_store.set_backend(doc_store.FileBackend(lambda: company_store.COMPANIES_DIR.parent))
    yield
    company_store.set_backend(prev)
