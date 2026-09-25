-- =============================================
-- nextgen-standup-bot : DATABASE SCHEMA
-- Run against PostgreSQL (default: postgres db)
--   psql -U postgres -d postgres -f db/schema.sql
-- =============================================

-- =============================================
-- TEAMS
-- =============================================
CREATE TABLE IF NOT EXISTS teams (
    id                   SERIAL PRIMARY KEY,
    team_name            VARCHAR(255) NOT NULL,
    teams_channel_id     VARCHAR(255),
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- TEAM MEMBERS
-- =============================================
CREATE TABLE IF NOT EXISTS team_members (
    id                   SERIAL PRIMARY KEY,
    team_id              INT REFERENCES teams(id) ON DELETE CASCADE,
    name                 VARCHAR(255) NOT NULL,
    email                VARCHAR(255),
    role                 VARCHAR(100),
    teams_user_id        VARCHAR(255),
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- STANDUP CONFIGURATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS standup_configurations (
    id                   SERIAL PRIMARY KEY,
    team_id              INT REFERENCES teams(id) ON DELETE CASCADE,
    escalation_enabled   BOOLEAN      DEFAULT FALSE,
    enabled              BOOLEAN      DEFAULT TRUE,
    response_timeout_minutes INT      DEFAULT 30,
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- STANDUP SESSIONS
-- =============================================
CREATE TABLE IF NOT EXISTS standup_sessions (
    id                   SERIAL PRIMARY KEY,
    team_id              INT REFERENCES teams(id) ON DELETE CASCADE,
    standup_date         TIMESTAMPTZ  NOT NULL,
    status               VARCHAR(50)  DEFAULT 'PENDING',
    lifecycle_status     VARCHAR(50)  DEFAULT 'STARTED',
    questions_sent_at    TIMESTAMPTZ,
    response_deadline    TIMESTAMPTZ,
    last_ping_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- WORK ITEMS
-- =============================================
CREATE TABLE IF NOT EXISTS work_items (
    id                   SERIAL PRIMARY KEY,
    external_ticket_id   VARCHAR(100),
    team_member_id       INT REFERENCES team_members(id) ON DELETE SET NULL,
    source_system        VARCHAR(100),
    title                TEXT,
    state                VARCHAR(100),
    priority             VARCHAR(50),
    inactive_days        INT          DEFAULT 0,
    days_in_state        INT          DEFAULT 0,
    last_updated         TIMESTAMPTZ,
    state_changed        TIMESTAMPTZ,
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- STANDUP QUESTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS standup_questions (
    id                   SERIAL PRIMARY KEY,
    standup_session_id   INT REFERENCES standup_sessions(id) ON DELETE CASCADE,
    team_member_id       INT REFERENCES team_members(id) ON DELETE CASCADE,
    work_item_id         INT REFERENCES work_items(id) ON DELETE SET NULL,
    question             TEXT NOT NULL,
    asked_to             VARCHAR(255),
    question_status      VARCHAR(50)  DEFAULT 'PENDING',
    answered_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- =============================================
-- STANDUP RESPONSES
-- =============================================
CREATE TABLE IF NOT EXISTS standup_responses (
    id                   SERIAL PRIMARY KEY,
    standup_question_id  INT REFERENCES standup_questions(id) ON DELETE CASCADE,
    response             TEXT,
    sentiment            VARCHAR(50),
    blocker_detected     BOOLEAN      DEFAULT FALSE,
    response_type        VARCHAR(20)  DEFAULT 'TEXT',
    risk_detected        BOOLEAN      DEFAULT FALSE,
    risk_reason          TEXT,
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
    risk_level           VARCHAR(20)  DEFAULT 'LOW',
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

-- =============================================
-- SEED DATA (matches mock data in azureDevopsService)
-- =============================================

-- Development team
INSERT INTO teams (id, team_name, teams_channel_id)
VALUES (1, 'Development Team', 'general')
ON CONFLICT (id) DO NOTHING;

-- Members (Anand & Rahul appear in the mock Azure DevOps data)
INSERT INTO team_members (id, team_id, name, email, role, teams_user_id)
VALUES
    (1, 1, 'Anand', 'anand@example.com', 'Developer', 'user-anand'),
    (2, 1, 'Rahul', 'rahul@example.com', 'Developer', 'user-rahul')
ON CONFLICT (id) DO NOTHING;

-- Enable standup for the team
INSERT INTO standup_configurations (id, team_id, escalation_enabled, enabled)
VALUES (1, 1, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Work item snapshots
INSERT INTO work_items (id, external_ticket_id, team_member_id, source_system, title, state, priority)
VALUES
    (1, '101', 1, 'azure-devops', 'Payment API integration pending', 'In Progress', 'High'),
    (2, '102', 2, 'azure-devops', 'Dashboard UI bug', 'Blocked', 'Medium')
ON CONFLICT (id) DO NOTHING;