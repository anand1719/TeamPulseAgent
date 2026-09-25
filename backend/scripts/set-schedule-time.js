// =============================================
// scripts/set-schedule-time.js
// Change a team's standup time (teams.schedule_time).
// This value ONLY drives the web-chat countdown UI;
// the actual trigger is STANDUP_CRON in .env.
//
//   node scripts/set-schedule-time.js 1 12:10
// =============================================

require("dotenv").config();

const pool = require("../db/postgres");

async function main() {
    const teamId = Number(process.argv[2] || 1);
    const time = String(process.argv[3] || "").trim();

    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
        console.error("Usage: node scripts/set-schedule-time.js <teamId> <HH:MM>");
        process.exit(1);
    }

    const normalized = time.length === 5 ? time + ":00" : time;

    const r = await pool.query(
        "UPDATE teams SET schedule_time = $1, updated_at = NOW() WHERE id = $2 " +
        "RETURNING id, team_name, schedule_time",
        [normalized, teamId]
    );

    console.log("Updated:", r.rows[0] || "no team with that id");
    await pool.end();
}

main().catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
});
