const pool = require("../db/postgres");

async function getReport(sessionId) {
    const reportQuery = `SELECT *
            FROM ai_insights
            WHERE standup_session_id = $1`
    const value = [sessionId]
    const result = await pool.query(reportQuery, value);
    return result;
}

module.exports = {
    getReport
}
