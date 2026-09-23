const express = require("express");
const router = express.Router();
const {getReport} = require("../services/reportService");
const {generateSummaryReportPdf} = require("../services/pdfReportService");

// GET STANDUP SUMMARY REPORT AS PDF
// The downloadable companion to the "Standup Summary"
// Adaptive Card that is posted in the channel. Rendered
// on demand, so this is also safe to open repeatedly.
router.get("/:sessionId/pdf", async (req, res) => {

    try {

        const { sessionId } = req.params;
        const report = await generateSummaryReportPdf(sessionId);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${ report.fileName }"`
        );
        res.setHeader("Content-Length", report.buffer.length);
        res.send(report.buffer);

    } catch (error) {

        // A missing session is a client error, not a bug.
        if (error.statusCode === 404) {
            res.status(404).json({
                message: error.message
            });
            return;
        }

        console.error("PDF Report Error:", error.message);

        res.status(500).json({
            message: "Failed to generate the PDF report."
        });
    }
});

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