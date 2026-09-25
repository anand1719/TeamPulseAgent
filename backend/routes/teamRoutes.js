const express = require("express");
const router = express.Router();
const pool = require("../db/postgres");
const {
    getTeams,
    getTeamMembers,
} = require("../services/teamService");

router.get("/", async (req, res) => {

    try {

        const result = await getTeams();
        res.json(result.rows);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});

// GET TEAM MEMBERS BY TEAM ID
router.get("/:teamId/members", async (req, res) => {
    try {
        const { teamId } = req.params;
        const result = await getTeamMembers(teamId);
        res.json(result.rows);
    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});
module.exports = router;