const express = require("express");
const router = express.Router();
const pool = require("../db/postgres");
const {getReport} = require("../services/reportService");

// GET FINAL REPORT
router.post("/generate", async (req, res) => {

    try {

        const { sessionId } = req.body;
        const result = await getReport(sessionId);
        res.json(result);
    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;