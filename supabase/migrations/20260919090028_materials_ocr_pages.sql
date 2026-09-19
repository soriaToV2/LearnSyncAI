-- ============================================================
-- 0028 · OCR transcript for scanned and photographed materials
-- ============================================================
--
-- The paper (p. 60) promises that image-based or scanned documents of up to 20
-- pages are "processed using Optical Character Recognition (OCR)". Until now
-- the ingest pipeline detected a scan (`materials.is_scanned`) and stored it
-- `failed` with "OCR is a later phase". This is that phase: the server now
-- transcribes each page with the multimodal model (`server/lib/ocr.ts`) and
-- hands the text to the same concept extractor a text PDF goes through.
--
-- ══ WHY THE TRANSCRIPT IS STORED ══
-- A language model reading a photo can misread a word, and the only way an
-- educator can tell a blurry photo from a bad concept is to see what was read.
-- The transcript is written BEFORE extraction runs, so a failure downstream
-- still leaves it. It is the evidence behind the paper's OCR claim, and it is
-- what lets a teacher retake ONE page rather than the whole lesson.
--
-- ══ SHAPE ══
-- `[{ "page": 1, "text": "…" }, …]` — one element per page, in page order,
-- `""` for a page the model could not read. The same `{page, text}` shape the
-- extractor consumes, so the stored value is exactly what extraction saw.
-- NULL for a text PDF (its text layer is the transcript) and for a scan that
-- has not been read yet.
--
-- ══ WHO READS IT ══
-- Only `GET /api/materials/:id/ocr-text`, owner-gated, fetched on demand by one
-- collapsible panel on the educator's material page. It is deliberately absent
-- from the list/detail selects (`MATERIAL_COLUMNS`) and from every student
-- read: a student reads the pages in the viewer, and the assistant reads the
-- concepts. No RLS change: policies are row-level, the browser never queries
-- this table directly (every read goes through Express, which selects explicit
-- columns), and the service role bypasses RLS for the API anyway.

ALTER TABLE public.materials
    ADD COLUMN IF NOT EXISTS ocr_pages JSONB;

COMMENT ON COLUMN public.materials.ocr_pages IS
    'Per-page transcript produced by OCR for scanned/photographed materials, [{page, text}] in page order; NULL for text PDFs.';
