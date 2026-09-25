const express = require("express");
const router = express.Router();
const {
    getInsightDetails,
    generateStandupInsights
} = require("../services/insightService");

// SAVE AI INSIGHTS
router.post("/", async (req, res) => {
    try {
        const result = await getInsightDetails(req.body);
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// POST insights/generate requires a session id now.
router.post("/generate", async (req, res) => {
    try {
        const sessionId = req.body.sessionId || req.body.session_id || req.query.sessionId;
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "sessionId is required"
            });
        }
        const insight =
            await generateStandupInsights(sessionId);
        res.json({
            success: true,
            data: insight
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;