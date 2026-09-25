const pool = require("../db/postgres");

async function getStandupConfigurations() {
    const query = `
        SELECT
            sc.id as configuration_id,
            sc.escalation_enabled,
            sc.enabled,
            sc.response_timeout_minutes,

            t.id as team_id,
            t.team_name,
            t.teams_channel_id,

            tm.id as member_id,
            tm.name,
            tm.email,
            tm.role,
            tm.teams_user_id

        FROM standup_configurations sc

        INNER JOIN teams t
            ON sc.team_id = t.id

            INNER JOIN team_members tm
            ON t.id = tm.team_id
		where tm.is_active=true and t.is_active=true
        ORDER BY t.team_name
    `;
    const result = await pool.query(query);
    return result.rows;
}

async function saveSession(params) {
    const {
        team_id,
        standup_date,
        status,
        lifecycle_status,
        response_deadline
    } = params;

    const query = `
        INSERT INTO standup_sessions
        (
            team_id,
            standup_date,
            status,
            lifecycle_status,
            response_deadline
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `;
    const values = [
        team_id,
        standup_date || new Date(),
        status || "IN_PROGRESS",
        lifecycle_status || "STARTED",
        response_deadline || null
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
}

async function getSession(sessionId) {
    const result = await pool.query(
        `SELECT
            s.*,
            t.team_name,
            sc.escalation_enabled,
            sc.response_timeout_minutes
        FROM standup_sessions s
        INNER JOIN teams t
            ON t.id = s.team_id
        LEFT JOIN standup_configurations sc
            ON sc.team_id = s.team_id
        WHERE s.id = $1`,
        [sessionId]
    );
    return result.rows[0] || null;
}

// Updates lifecycle_status (and optionally status) and
// returns the updated row.
async function updateSessionLifecycle(sessionId, lifecycleStatus, extras) {
    const extraCols = [];
    const extraVals = [];

    if (extras && typeof extras === "object") {
        for (const [key, value] of Object.entries(extras)) {
            if (value === undefined) continue;
            const index = extraVals.length + 1;
            extraCols.push(`${ key } = $${ index }`);
            extraVals.push(value);
        }
    }

    const cols = [...extraCols];
    const vals = [...extraVals];
    let offset = vals.length;

    cols.push(`lifecycle_status = $${ ++offset }`);
    vals.push(lifecycleStatus);

    if (lifecycleStatus === "COMPLETED") {
        cols.push(`status = $${ ++offset }`);
        vals.push("COMPLETED");
        cols.push(`completed_at = $${ ++offset }`);
        vals.push(new Date());
    }

    const result = await pool.query(
        `UPDATE standup_sessions
         SET ${ cols.join(", ") }
         WHERE id = $${ ++offset }`,
        [...vals, sessionId]
    );

    return getSession(sessionId);
}

// Counts answered / total for a session and whether
// any question is still PENDING (past the deadline it
// becomes NO_RESPONSE, so this drives early-finalize).
async function getSessionProgress(sessionId) {
    const result = await pool.query(
        `SELECT
            COUNT(*)::int                          AS total,
            COUNT(*) FILTER (WHERE question_status = 'ANSWERED')::int AS answered,
            COUNT(*) FILTER (WHERE question_status = 'NO_RESPONSE')::int AS no_response
        FROM standup_questions
        WHERE standup_session_id = $1`,
        [sessionId]
    );

    const row = result.rows[0] || { total: 0, answered: 0 };

    return {
        total: row.total || 0,
        answered: row.answered || 0,
        noResponse: row.no_response || 0,
        allAnswered: row.total > 0 && row.answered === row.total
    };
}

// Sessions actively waiting for responses (for the
// plain-text reply fallback in the bot)).
async function getActiveWaitingSessions() {
    const result = await pool.query(
        `SELECT id
         FROM standup_sessions
         WHERE lifecycle_status = 'WAITING_FOR_RESPONSES'
         ORDER BY id DESC`
    );
    return result.rows;
}

module.exports = {
    getStandupConfigurations,
    saveSession,
    getSession,
    updateSessionLifecycle,
    getSessionProgress,
    getActiveWaitingSessions
};
