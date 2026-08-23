const pool = require("../db/postgres");

async function saveUserResponse(params) {
        const {
            standup_question_id,
            response,
            sentiment,
            blocker_detected
        } = params;

        const query =            `
            INSERT INTO standup_responses
            (
                standup_question_id,
                response,
                sentiment,
                blocker_detected
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `;
        const value =  [
                standup_question_id,
                response,
                sentiment,
                blocker_detected
            ];
        
        const result = await pool.query(query,value)
        return result;
}

module.exports ={
    saveUserResponse
}