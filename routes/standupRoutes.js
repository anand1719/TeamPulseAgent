const express = require("express");
const router = express.Router();
const {
    getStandupConfigurations,
    saveSession
} = require("../services/standupService");

router.get("/configurations", async (req, res) => {
    try {
        const configurations =
            await getStandupConfigurations();

        res.json({
            success: true,
            data: configurations
        });

    } catch (error) {

        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error fetching configurations"
        });
    }
});

// CREATE STANDUP SESSION
router.post("/session", async (req, res) => {
    try {

        const result = await saveSession(req.body);
        res.json(result.rows[0]);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;

