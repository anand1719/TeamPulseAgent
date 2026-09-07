const express = require("express");
const router = express.Router();
const {getReport} = require("../services/reportService");

// GET FINAL REPORT
router.get("/:sessionId", async (req, res) => {

    try {

        const { sessionId } = req.params;
        const result = await getReport(sessionId);
        res.json(result.rows[0]);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;