const pool = require("../db/postgres");

async function saveUserResponse(params) {
    const {
        standup_question_id,
        response,
        sentiment,
        blocker_detected,
        response_type,
        risk_detected,
        risk_reason
    } = params;

    const query = `
            INSERT INTO standup_responses
            (
                standup_question_id,
                response,
                sentiment,
                blocker_detected,
                response_type,
                risk_detected,
                risk_reason
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            `;
    const value = [
        standup_question_id,
        response,
        sentiment,
        blocker_detected || false,
        response_type || 'TEXT',
        risk_detected || false,
        risk_reason || null
    ];

    const result = await pool.query(query, value);
    return result;
}

module.exports = {
    saveUserResponse
};
