const express = require("express");
const router = express.Router();
const pool = require("../db/postgres");
const {saveQuestions} = require("../services/questionService")


// SAVE GENERATED QUESTION
router.post("/", async (req, res) => {
    try {
        const result = await saveQuestions(req.body);
        res.json(result.rows[0]);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;