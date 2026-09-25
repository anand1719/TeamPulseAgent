-- =============================================
-- ado_updates table
-- Stores the per-ticket Azure DevOps updates
-- PROPOSED from evening-standup answers, and the
-- result after the user confirms the push.
-- =============================================

CREATE TABLE IF NOT EXISTS ado_updates (
    id SERIAL PRIMARY KEY,
    standup_session_id INTEGER NOT NULL
        REFERENCES standup_sessions(id) ON DELETE CASCADE,
    work_item_id INTEGER,
    external_ticket_id VARCHAR(50) NOT NULL,
    proposed_status VARCHAR(100),
    proposed_comment TEXT,
    applied_status VARCHAR(100),
    applied_at TIMESTAMPTZ,
    apply_result JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ado_updates_session
    ON ado_updates(standup_session_id);

-- =============================================
-- Evening-only standup schedule
-- The standup runs once per day in the evening.
-- =============================================

UPDATE teams
SET schedule_time = '18:00:00',
    updated_at = NOW()
WHERE schedule_time IS NOT NULL
  AND schedule_time < '18:00:00';