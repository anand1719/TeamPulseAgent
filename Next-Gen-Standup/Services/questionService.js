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
                asked_to
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            `;
        const value = [
                standup_session_id,
                team_member_id,
                work_item_id,
                question,
                asked_to
            ];
        
        const result = await pool.query(query,value);    
        return result;    
}

module.exports ={
    saveQuestions
}