"""Tests for the "Phase 5b" date-extraction regexes added to
app/services/cop_bill_parser.py (WORK_DONE_PERIOD_RE / RA_BILL_NO_RE /
COP_DATE_RE / _normalize_date). These exist so a Certificate of Payment
PDF's own bill date -- not whatever date the uploader happened to type
on upload day -- drives the dashboard's time series (see
app/api/phase3.py's upload_bill()).

The fixture text below is copied verbatim from a REAL Certificate of
Payment PDF's page-1 extract_text() output, confirmed matching directly
against that document during this feature's own planning (the user
shared the real PDF for exactly this purpose) -- not a hand-invented
approximation of the format. No PDF file is bundled with this repo, so
these tests exercise the regexes/normalizer directly against that same
real text rather than going through pdfplumber.open() at all; the full
parse_cop_pdf() pipeline (line-item extraction, column bands, checksum)
already has its own golden-file coverage elsewhere and is unaffected by
this change.
"""

from __future__ import annotations

from app.services.cop_bill_parser import COP_DATE_RE, RA_BILL_NO_RE, WORK_DONE_PERIOD_RE, _normalize_date

REAL_PAGE1_TEXT = """Certificate of Payment(COP)
Contractor Name : KALPATARU PROJECTS INTERNATIONAL Project Name: Provident Ecopolitan- Ph1 common
Vendor Code : 62003542 COP No. : 20253150000102 Entity : Provident White Oaks LLP
Work Order No. : 4540012028 RA Bill No. : RA00000021 Region : 29 Karnataka
Work Order Dt. : 15 December 2023 Invoice No. : BS-KA-25-12543 Invoice Dt. : 25.12.2025
Work done period : 01-11-2025 To 30-11-2025 COP Date : 02.01.2026
Type of Work: Structure & Finishing Works."""


def test_work_done_period_extracts_start_and_end():
    m = WORK_DONE_PERIOD_RE.search(REAL_PAGE1_TEXT)
    assert m is not None
    assert m.group(1) == "01-11-2025"
    assert m.group(2) == "30-11-2025"


def test_ra_bill_no_extracted():
    m = RA_BILL_NO_RE.search(REAL_PAGE1_TEXT)
    assert m is not None
    assert m.group(1) == "RA00000021"


def test_cop_date_extracted_separately_from_work_done_period():
    # COP Date (when the certificate was signed) is deliberately NOT the
    # same date used as billed_date -- see cop_bill_parser.py's module
    # comment on WORK_DONE_PERIOD_RE. Confirm the two dates are read
    # independently and are, in this real example, genuinely different
    # (the certificate lags the work period by over a month).
    m = COP_DATE_RE.search(REAL_PAGE1_TEXT)
    assert m is not None
    assert m.group(1) == "02.01.2026"


def test_normalize_date_handles_both_real_separators():
    assert _normalize_date("30-11-2025", "-") == "2025-11-30"
    assert _normalize_date("02.01.2026", ".") == "2026-01-02"


def test_normalize_date_returns_none_for_garbage_rather_than_raising():
    assert _normalize_date("not-a-date", "-") is None
    assert _normalize_date("31-02-2025", "-") is None  # Feb 31st doesn't exist


def test_no_match_on_text_without_the_expected_fields():
    assert WORK_DONE_PERIOD_RE.search("some unrelated document text") is None
    assert COP_DATE_RE.search("some unrelated document text") is None
    assert RA_BILL_NO_RE.search("some unrelated document text") is None


def test_parse_cop_pdf_end_to_end_date_fields_against_the_real_document():
    """Only runs against the actual uploaded sample PDF, when present on
    this machine (it lives outside the repo, under this session's
    uploads directory) -- skipped everywhere else rather than failing,
    since the file isn't and shouldn't be committed to the repo."""
    import pathlib

    import pytest

    sample = pathlib.Path("/root/.claude/uploads/4ffe99a8-50a4-55bc-aee0-f3c491a51a8b/6fdbc478-Nov25.pdf")
    if not sample.exists():
        pytest.skip("Real sample COP PDF not present on this machine.")

    from app.services.cop_bill_parser import parse_cop_pdf

    result = parse_cop_pdf(str(sample))
    assert result.work_done_period_start == "2025-11-01"
    assert result.work_done_period_end == "2025-11-30"
    assert result.cop_date == "2026-01-02"
    assert result.ra_bill_no == "RA00000021"
    assert result.parse_checksum_ok is True
