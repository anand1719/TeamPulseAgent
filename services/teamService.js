const pool = require("../db/postgres");

async function getTeams() {
    const query = `SELECT * FROM teams`;
    const result = await pool.query(query);
    return result;    
}

async function getTeamMembers(teamId) {
    const memberQuery =            `
            SELECT *
            FROM team_members
            WHERE team_id = $1
            `;
    const values = [teamId];
    const result = await pool.query(memberQuery, values);
    return result;    
}

module.exports = {
 getTeams,   
 getTeamMembers
};

