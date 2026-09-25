-- =============================================
-- FIX: Missing tables in the local PostgreSQL DB
-- The live DB is missing standup_responses,
-- ai_insights, and escalations (all are referenced
-- by routes/services but were never created).
--
-- Apply with:  psql -U postgres -d postgres -f db/fix_missing_tables.sql
-- (or run db/apply_fix.js which uses the same
--  credentials as db/postgres.js)
-- =============================================

-- =============================================
-- STANDUP RESPONSES
-- =============================================
CREATE TABLE IF NOT EXISTS standup_responses (
    id                   SERIAL PRIMARY KEY,
    standup_question_id  INT REFERENCES standup_questions(id) ON DELETE CASCADE,
    response             TEXT,
    sentiment            VARCHAR(50),
    blocker_detected     BOOLEAN      DEFAULT FALSE,
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- AI INSIGHTS
-- =============================================
CREATE TABLE IF NOT EXISTS ai_insights (
    id                   SERIAL PRIMARY KEY,
    standup_session_id   INT REFERENCES standup_sessions(id) ON DELETE CASCADE,
    summary              TEXT,
    blockers             TEXT,
    risks                TEXT,
    recommendations      TEXT,
    sentiment            VARCHAR(50),
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- ESCALATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS escalations (
    id                   SERIAL PRIMARY KEY,
    work_item_id         INT REFERENCES work_items(id) ON DELETE CASCADE,
    team_member_id       INT REFERENCES team_members(id) ON DELETE CASCADE,
    severity             VARCHAR(50),
    escalation_reason    TEXT,
    notified_to          VARCHAR(255),
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);