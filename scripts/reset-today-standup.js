// =============================================
// scripts/reset-today-standup.js
// Deletes TODAY's standup session(s) so the
// scheduler flow can be re-tested from scratch
// (the per-day guard is "one session per team
// per day", so without a reset the scheduler
// will just skip the team).
//
//   node scripts/reset-today-standup.js        (all teams)
//   node scripts/reset-today-standup.js 1      (team 1 only)
//
// Questions / responses / insights / ado_updates
// are removed by ON DELETE CASCADE.
// =============================================

require("dotenv").config();

const pool = require("../db/postgres");

async function main() {
    const teamId = process.argv[2] ? Number(process.argv[2]) : null;

    const sessions = await pool.query(
        "SELECT id, team_id, standup_date, lifecycle_status " +
        "FROM standup_sessions " +
        "WHERE standup_date::date = CURRENT_DATE " +
        "  AND ($1::int IS NULL OR team_id = $1) " +
        "ORDER BY id",
        [teamId]
    );

    if (!sessions.rows.length) {
        console.log("Nothing to reset - no session today" +
            (teamId ? " for team " + teamId : "") + ".");
        await pool.end();
        return;
    }

    for (const s of sessions.rows) {
        const deleted = await pool.query(
            "DELETE FROM standup_sessions WHERE id = $1 RETURNING id",
            [s.id]
        );
        console.log(
            "Deleted session " + s.id +
            " (team " + s.team_id +
            ", was " + s.lifecycle_status +
            ") -> " + (deleted.rowCount ? "ok" : "not found")
        );
    }

    await pool.end();
}

main().catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
});
