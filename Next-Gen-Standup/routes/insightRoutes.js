const express = require("express");
const router = express.Router();
const {
    getInsightDetails
} = require("../services/insightService");

// SAVE AI INSIGHTS
router.post("/", async (req, res) => {
    try {
        const result = await getInsightDetails(req.body);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("INSIGHT ROUTE ERROR:");
        console.error(error);
        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;