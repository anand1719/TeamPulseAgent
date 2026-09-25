const pool = require("../db/postgres");
const { generateSessionInsights, assessSessionEscalation } = require("./aiService");
const { getSessionQuestions } = require("./questionService");

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
                sentiment,
                risk_level
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            `;
    const values = [
        standup_session_id,
        summary,
        blockers,
        risks,
        recommendations,
        sentiment,
        params.risk_level || "LOW"
    ];

    const result = await pool.query(query, values);
    return result;
}

// =============================================
// GENERATE AI INSIGHTS FOR A SPECIFIC SESSION
// Unlike the old "latest session" version, this targets
// the session explicitly so insights are only produced
// for sessions that actually progressed (and it runs
// through the same AI + deterministic-fallback pipeline).
// =============================================
async function generateStandupInsights(sessionId) {
    const rows = await getSessionQuestions(sessionId);

    if (!rows || !rows.length) {
        throw new Error("No questions found for standup session " + sessionId);
    }

    const insights = await generateSessionInsights(rows);
    const assessment = assessSessionEscalation(rows);

    const result = await pool.query(
        `INSERT INTO ai_insights
        (
            standup_session_id,
            summary,
            blockers,
            risks,
            recommendations,
            sentiment,
            risk_level
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
            sessionId,
            insights.summary,
            (insights.blockers || []).join(" | ") || null,
            (insights.risks || []).join(" | ") || null,
            (insights.recommendations || []).join(" | ") || null,
            insights.sentiment || "NEUTRAL",
            assessment.severity
        ]
    );

    return result.rows[0];
}

module.exports = {
    getInsightDetails,
    generateStandupInsights
};

