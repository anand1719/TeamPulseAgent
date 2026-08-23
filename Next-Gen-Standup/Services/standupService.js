const pool = require("../db/postgres");
async function getStandupConfigurations() {
  const query = `
        SELECT
            sc.id as configuration_id,
            sc.escalation_enabled,
            sc.enabled,

            t.id as team_id,
            t.team_name,
            t.teams_channel_id,

            tm.id as member_id,
            tm.name,
            tm.email,
            tm.role,
            tm.teams_user_id,
            sc.manager_name,
            sc.manager_email

        FROM standup_configurations sc

        INNER JOIN teams t
            ON sc.team_id = t.id

            INNER JOIN team_members tm
            ON t.id = tm.team_id

        ORDER BY t.team_name
    `;
    const result = await pool.query(query);
    return result.rows;
}

async function saveSession(params) {
        const {
            team_id,
            standup_date
        } = params;

        const query = `
            INSERT INTO standup_sessions
            (
                team_id,
                standup_date
            )
            VALUES ($1, $2)
            RETURNING *
            `;
        const value = [team_id, standup_date];
        const result = pool.query(query,value);
        return result;
    }

module.exports = {
    getStandupConfigurations,
    saveSession
};