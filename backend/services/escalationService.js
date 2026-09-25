const pool = require("../db/postgres");
async function addEscalation(params) {
    const {
            work_item_id,
            team_member_id,
            severity,
            escalation_reason,
            notified_to
        } = params;

    const query = `
            INSERT INTO escalations
            (
                work_item_id,
                team_member_id,
                severity,
                escalation_reason,
                notified_to
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            `;
        const values = [
                work_item_id,
                team_member_id,
                severity,
                escalation_reason,
                notified_to
            ];
        
        const result = await pool.query(query,values);
        return result;        
}

module.exports = {
    addEscalation
}
