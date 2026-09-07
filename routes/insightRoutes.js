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

// GENERATE AI INSIGHTS FROM LATEST STANDUP SESSION
router.post("/generate", async (req, res) => {
    try {
        const insight =
            await generateStandupInsights();
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