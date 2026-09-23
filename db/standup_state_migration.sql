-- =============================================
-- nextgen-standup-bot : STATE MACHINE MIGRATION
-- Applies to the LIVE PostgreSQL schema.
--   psql -U postgres -d Smart_Standup -p 5433 -f db/standup_state_migration.sql
-- Also auto-applied at boot by orchestration/applyMigration.js
--
-- Adds the columns required for the persisted standup
-- lifecycle:
--   STARTED -> QUESTIONS_SENT -> WAITING_FOR_RESPONSES
--     -> RESPONSES_RECEIVED -> AI_PROCESSING
--     -> INSIGHTS_GENERATED -> [ESCALATION] -> COMPLETED
-- with per-question PENDING / ANSWERED / NO_RESPONSE status,
-- a single configurable response deadline, and no reminder logic.
-- =============================================

-- =============================================
-- standup_configurations: per-team response deadline
-- (minutes). Falls back to STANDUP_TIMEOUT_MINUTES env.
-- =============================================
ALTER TABLE standup_configurations
    ADD COLUMN IF NOT EXISTS response_timeout_minutes INT DEFAULT 30;

-- =============================================
-- standup_sessions: lifecycle status + deadlines
-- =============================================
ALTER TABLE standup_sessions
    ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(50) DEFAULT 'STARTED',
    ADD COLUMN IF NOT EXISTS questions_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMPTZ;

-- Backfill existing IN_PROGRESS sessions so the new state machine
-- treats them as already in the waiting window.
UPDATE standup_sessions
SET lifecycle_status = 'WAITING_FOR_RESPONSES',
    questions_sent_at = COALESCE(questions_sent_at, started_at),
    response_deadline = COALESCE(response_deadline, started_at + INTERVAL '30 minutes')
WHERE status = 'IN_PROGRESS'
  AND lifecycle_status = 'STARTED';

-- =============================================
-- standup_questions: asked_to (card address) +
-- per-question response status lifecycle
-- =============================================
ALTER TABLE standup_questions
    ADD COLUMN IF NOT EXISTS asked_to VARCHAR(255),
    ADD COLUMN IF NOT EXISTS question_status VARCHAR(50) DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;

-- =============================================
-- standup_responses: distinguish typed vs button
-- responses for reporting
-- =============================================
ALTER TABLE standup_responses
    ADD COLUMN IF NOT EXISTS response_type VARCHAR(20) DEFAULT 'TEXT',
    ADD COLUMN IF NOT EXISTS risk_detected BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS risk_reason TEXT;

-- =============================================
-- ai_insights: risk level for the decision engine
-- =============================================
ALTER TABLE ai_insights
    ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'LOW';

-- =============================================
-- work_items: inactivity + state-duration snapshot
-- (older live DBs only have inactive_days; the card
-- badge needs days_in_state + timestamps too)
-- =============================================
ALTER TABLE work_items
    ADD COLUMN IF NOT EXISTS inactive_days INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS days_in_state INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS state_changed TIMESTAMPTZ;

-- =============================================
-- Indexes for the timeout queries
-- =============================================
CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle_status
    ON standup_sessions (lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_sessions_deadline
    ON standup_sessions (response_deadline);

CREATE INDEX IF NOT EXISTS idx_questions_session_status
    ON standup_questions (standup_session_id, question_status);

CREATE INDEX IF NOT EXISTS idx_responses_question
    ON standup_responses (standup_question_id);