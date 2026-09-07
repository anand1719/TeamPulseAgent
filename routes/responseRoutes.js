const express = require("express");
const router = express.Router();
const pool = require("../db/postgres");
const {saveUserResponse} = require("../services/responseService")

// SAVE USER RESPONSE
router.post("/", async (req, res) => {

    try {
        const result = await saveUserResponse(req.body);
        res.json(result.rows[0]);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;