-- OPTIONAL. The API creates this row automatically on the first manual POST.
-- Run it in DBeaver only if you prefer to seed it yourself (safe to re-run).
-- Manual records use this source so they can never be mistaken for BMKG data.
INSERT INTO data_sources (code, name, base_url, description, is_active)
VALUES ('MANUAL', 'Manual entry (Heiz API clients)', 'https://example.invalid/heiz-manual',
        'Records created through the Heiz API; not official data.', TRUE)
ON CONFLICT (code) DO NOTHING;
