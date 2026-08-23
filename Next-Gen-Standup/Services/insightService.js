const pool = require("../db/postgres");
async function getInsightDetails(params) {
    const {
            standup_session_id,
            summary,
            blockers,
            risks,
            recommendations,
            sentiment
        } = params;

    const query = `
            INSERT INTO ai_insights
            (
                standup_session_id,
                summary,
                blockers,
                risks,
                recommendations,
                sentiment
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            `;

    const values =  [
                standup_session_id,
                summary,
                blockers,
                risks,
                recommendations,
                sentiment
            ];
    console.log("Insight array",values);            
    const result = await pool.query(query,values);
    return result;
}
module.exports = {
getInsightDetails
};