// =============================================
// scripts/run-standup-now.js
// Runs EXACTLY what the cron does in WEB MODE
// (no Teams conversation available):
//   runStandupForAllTeams() -> one session per
//   team per day + evening questions.
//
//   node scripts/run-standup-now.js
//
// Use it to test the flow without waiting for
// STANDUP_CRON. It does NOT touch the Teams bot
// and does NOT start a second cron.
// =============================================

require("dotenv").config();

const { runStandupForAllTeams } = require("../services/sessionStarter");
const pool = require("../db/postgres");

async function main() {
    console.log("Triggering the scheduler workflow (web mode)...");

    const results = await runStandupForAllTeams();

    if (!results.length) {
        console.log("No teams with an enabled standup configuration found.");
    }

    for (const r of results) {
        if (r.error) {
            console.error(
                "FAILED  " + r.teamName + " (" + r.teamId + "): " + r.error
            );
        } else if (r.created) {
            console.log(
                "CREATED session " + r.sessionId + " for " + r.teamName
            );
        } else {
            console.log(
                "SKIPPED " + r.teamName +
                " (today's session already exists: " + r.sessionId + ")"
            );
        }
    }

    await pool.end();
}

main().catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
});
