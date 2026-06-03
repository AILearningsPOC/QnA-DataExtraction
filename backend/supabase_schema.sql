-- ================================================================
-- Q&A Automation — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → Run
-- ================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── PRODUCTS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id   TEXT NOT NULL,
  retailer_name TEXT NOT NULL,
  sku           TEXT NOT NULL,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  base_price    DECIMAL(10,2),
  price         DECIMAL(10,2),
  rating        DECIMAL(3,1),
  review_count  INTEGER DEFAULT 0,
  image         TEXT,
  specs         JSONB DEFAULT '{}',
  product_url   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(retailer_id, sku)
);

-- ── QUESTIONS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  retailer_id     TEXT NOT NULL,
  question_text   TEXT NOT NULL,
  asked_by        TEXT DEFAULT 'Anonymous',
  asked_at        TIMESTAMPTZ DEFAULT NOW(),
  status          TEXT DEFAULT 'unanswered'
                    CHECK (status IN ('unanswered','answered','review')),
  ai_generated    BOOLEAN DEFAULT FALSE,
  -- AI enrichment fields
  language        TEXT DEFAULT 'en',
  language_name   TEXT DEFAULT 'English',
  category        TEXT DEFAULT 'product_info'
                    CHECK (category IN (
                      'product_info','pricing','warranty',
                      'compatibility','usage','complaint','returns','other'
                    )),
  sentiment       TEXT DEFAULT 'neutral'
                    CHECK (sentiment IN ('positive','neutral','negative')),
  ai_confidence   DECIMAL(5,2) DEFAULT 0,
  review_reason   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── ANSWERS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID REFERENCES questions(id) ON DELETE CASCADE UNIQUE,
  answer_text     TEXT NOT NULL,
  answered_by     TEXT DEFAULT 'HisenseExpert',
  answered_at     TIMESTAMPTZ DEFAULT NOW(),
  is_approved     BOOLEAN DEFAULT FALSE,
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  kb_sources      TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── KNOWLEDGE BASE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_base (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  kb_category      TEXT DEFAULT 'product_info'
                     CHECK (kb_category IN (
                       'product_info','pricing','warranty',
                       'compatibility','usage','complaint','returns',
                       'faq','policy','approved_answer'
                     )),
  product_category TEXT,   -- tv, refrigerator, etc. NULL = applies to all
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  tags             TEXT[] DEFAULT '{}',
  source           TEXT DEFAULT 'manual'
                     CHECK (source IN ('manual','approved_answer','import','seed')),
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_questions_product    ON questions(product_id);
CREATE INDEX IF NOT EXISTS idx_questions_retailer   ON questions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_questions_status     ON questions(status);
CREATE INDEX IF NOT EXISTS idx_questions_category   ON questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_language   ON questions(language);
CREATE INDEX IF NOT EXISTS idx_answers_question     ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_kb_category          ON knowledge_base(kb_category);
CREATE INDEX IF NOT EXISTS idx_kb_product_category  ON knowledge_base(product_category);
CREATE INDEX IF NOT EXISTS idx_kb_active            ON knowledge_base(is_active);

-- ── ROW LEVEL SECURITY (open for POC) ───────────────────────────
ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- Allow all operations (POC — tighten for production)
CREATE POLICY "allow_all" ON products       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON questions      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON answers        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON knowledge_base FOR ALL USING (true) WITH CHECK (true);

-- ── AUTO-UPDATE updated_at ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kb_updated_at
  BEFORE UPDATE ON knowledge_base
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

