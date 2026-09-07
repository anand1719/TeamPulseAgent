const pool = require('./db/postgres');

(async () => {
    try {
        console.log('=== TEAMS ===');
        const teams = await pool.query('SELECT id, team_name FROM teams ORDER BY id');
        for (const row of teams.rows) console.log(JSON.stringify(row));

        console.log('=== TEAM MEMBERS ===');
        const members = await pool.query('SELECT id, team_id, name FROM team_members ORDER BY id');
        for (const row of members.rows) console.log(JSON.stringify(row));

        console.log('=== STANDUP CONFIGURATIONS ===');
        const configs = await pool.query('SELECT id, team_id, enabled FROM standup_configurations ORDER BY id');
        for (const row of configs.rows) console.log(JSON.stringify(row));

        console.log('=== SESSIONS (last 10) ===');
        const sessions = await pool.query('SELECT id, team_id, status, standup_date, started_at FROM standup_sessions ORDER BY id DESC LIMIT 10');
        for (const row of sessions.rows) console.log(JSON.stringify(row));
    } catch (err) {
        console.error('ERR:', err.message);
    } finally {
        await pool.end();
    }
})();