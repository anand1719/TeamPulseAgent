const express = require("express");
const router = express.Router();

const {
    bootstrapWebSession,
    answerWebQuestion,
    confirmAdoUpdates,
    getAdoProposals,
    getSessionSummary,
    getTeamWithMembers,
    getScheduleInfo,
} = require("../services/webChatService");
const { getSessionQuestions } = require("../services/questionService");

// Everything the chat UI needs on load:
// team + members + today's session + questions +
// work items + schedule. JOIN-ONLY: reports a
// "scheduled" state when the scheduler has not
// created today's session yet.
router.get("/bootstrap", async (req, res) => {
    try {
        const data = await bootstrapWebSession({
            teamId: req.query.teamId,
            memberName: req.query.memberName,
        });
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

// Standup schedule info (evening, once per day).
router.get("/schedule", async (req, res) => {
    try {
        const data = await getScheduleInfo(req.query.teamId || null);
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

// Manual standup starts are NOT allowed - the
// standup is started only by the configured
// scheduler (cron).
router.post("/sessions", async (req, res) => {
    res.status(403).json({
        success: false,
        message: "Standup can only be started by the configured scheduler.",
    });
});

// GET /api/web-chat/sessions/:id/questions
router.get("/sessions/:id/questions", async (req, res) => {
    try {
        const rows = await getSessionQuestions(req.params.id);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

// POST /api/web-chat/questions/:id/answer
// { response: "...", status?: "In Progress" }
router.post("/questions/:id/answer", async (req, res) => {
    try {
        const result = await answerWebQuestion(req.params.id, req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

// GET /api/web-chat/sessions/:id/summary
router.get("/sessions/:id/summary", async (req, res) => {
    try {
        const data = await getSessionSummary(req.params.id);
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

// GET /api/web-chat/sessions/:id/ado-proposals
// Proposed Azure DevOps updates (status + comment
// per ticket) computed from the standup answers.
router.get("/sessions/:id/ado-proposals", async (req, res) => {
    try {
        const data = await getAdoProposals(req.params.id);
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

// POST /api/web-chat/sessions/:id/ado-updates/confirm
// { updates: [{ updateId|ticketId, status?, comment? }] }
// Explicit confirmation - pushes comments (and state
// changes) to the Azure DevOps board per ticket.
router.post("/sessions/:id/ado-updates/confirm", async (req, res) => {
    try {
        const results = await confirmAdoUpdates(
            req.params.id,
            (req.body && req.body.updates) || []
        );
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

// GET /api/web-chat/teams/:teamId
router.get("/teams/:teamId", async (req, res) => {
    try {
        const data = await getTeamWithMembers(req.params.teamId);
        if (!data.team) {
            return res.status(404).json({ success: false, message: "Team not found" });
        }
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false, message: error.message,
        });
    }
});

module.exports = router;
