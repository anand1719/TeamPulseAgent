const pool = require("../db/postgres");

async function saveQuestions(params) {
    const {
        standup_session_id,
        team_member_id,
        work_item_id,
        question,
        asked_to
    } = params;

    const query = `
        INSERT INTO standup_questions
        (
            standup_session_id,
            team_member_id,
            work_item_id,
            question,
            asked_to,
            question_status
        )
        VALUES ($1, $2, $3, $4, $5, 'PENDING')
        RETURNING *
    `;
    const value = [
        standup_session_id,
        team_member_id,
        work_item_id,
        question,
        asked_to || null
    ];

    const result = await pool.query(query, value);
    return result;
}

// =============================================
// GET ALL QUESTIONS FOR A SESSION (joined)
// Used by: finalize/insights pipeline + timeout.
//
// Each row includes member_name, work item title,
// the saved response (if any), per-question status,
// sentiment/blocker/risk flags and the risk reason.
// =============================================
// Most recent confirmed Azure DevOps status for this ticket in this
// session. The web-chat card persists each push in ado_updates, so old
// sessions can still report "Done" even when the work_items snapshot or
// the live board lookup is unavailable.
async function getSessionQuestions(sessionId) {
    const result = await pool.query(
        `SELECT
            sq.id,
            sq.standup_session_id,
            sq.team_member_id,
            sq.work_item_id,
            sq.question,
            sq.asked_to,
            sq.question_status,
            sq.answered_at,

            tm.name AS member_name,
            tm.email AS member_email,
            tm.teams_user_id,

            wi.external_ticket_id AS ticket_id,
            wi.title AS work_item_title,
            wi.state AS work_item_state,
            COALESCE(wi.days_in_state, wi.inactive_days, 0) AS days_in_state,
            COALESCE(wi.inactive_days, 0) AS inactive_days,

            (
                SELECT applied_status
                FROM ado_updates
                WHERE standup_session_id = sq.standup_session_id
                  AND external_ticket_id = wi.external_ticket_id
                  AND applied_status IS NOT NULL
                ORDER BY applied_at DESC NULLS LAST, id DESC
                LIMIT 1
            ) AS ado_applied_status,

            sr.id AS response_id,
            sr.response,
            sr.sentiment,
            sr.blocker_detected,
            sr.risk_detected,
            sr.risk_reason,
            sr.response_type

        FROM standup_questions sq
        INNER JOIN team_members tm
            ON tm.id = sq.team_member_id
        LEFT JOIN work_items wi
            ON wi.id = sq.work_item_id
        LEFT JOIN standup_responses sr
            ON sr.standup_question_id = sq.id
        WHERE sq.standup_session_id = $1
        ORDER BY sq.id ASC`,
        [sessionId]
    );

    return result.rows;
}

// =============================================
// FIND THE OPEN QUESTION FOR A MEMBER
// Used by the plain-text reply fallback: the bot
// matches the sender to an unanswered question,
// so a typed "Blocked on the API" can be saved
// without the Adaptive Card payload.
// =============================================
async function getOpenQuestionForMember(sessionId, memberIdentifier) {
    const result = await pool.query(
        `SELECT
            sq.*,
            tm.name AS member_name,
            tm.email AS member_email,
            tm.teams_user_id,
            wi.external_ticket_id AS ticket_id,
            wi.title AS work_item_title,
            wi.state AS work_item_state,
            wi.inactive_days
        FROM standup_questions sq
        INNER JOIN team_members tm
            ON tm.id = sq.team_member_id
        LEFT JOIN work_items wi
            ON wi.id = sq.work_item_id
        WHERE sq.standup_session_id = $1
          AND sq.question_status = 'PENDING'
          AND (
                LOWER(tm.name) = LOWER($2)
                OR LOWER(tm.email) = LOWER($2)
                OR tm.teams_user_id = $2
              )
        ORDER BY sq.id ASC
        LIMIT 1`,
        [sessionId, String(memberIdentifier)]
    );
    return result.rows[0] || null;
}

// =============================================
// MARK A QUESTION ANSWERED
// =============================================
async function markQuestionAnswered(questionId) {
    const result = await pool.query(
        `UPDATE standup_questions
         SET question_status = 'ANSWERED', answered_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [questionId]
    );
    return result.rows[0] || null;
}

// =============================================
// MARK ALL STILL-PENDING QUESTIONS AS NO_RESPONSE
// Called when the response deadline is reached。
// =============================================
async function markPendingQuestionsNoResponse(sessionId) {
    const result = await pool.query(
        `UPDATE standup_questions
         SET question_status = 'NO_RESPONSE'
         WHERE standup_session_id = $1
           AND question_status = 'PENDING'
         RETURNING *`,
        [sessionId]
    );
    return result.rows;
}

module.exports = {
    saveQuestions,
    getSessionQuestions,
    getOpenQuestionForMember,
    markQuestionAnswered,
    markPendingQuestionsNoResponse
};