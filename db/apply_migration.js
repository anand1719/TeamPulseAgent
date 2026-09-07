// Applies db/standup_state_migration.sql using the same
// postgres pool config as db/postgres.js.
// Run: node db/apply_migration.js
const fs = require('fs');
const path = require('path');
const pool = require('./postgres');

(async () => {
    const sqlPath = path.join(__dirname, 'standup_state_migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    try {
        await pool.query(sql);
        console.log('State-machine migration applied successfully.');
    } catch (err) {
        console.error('Error applying migration:', err.message);
        process.exitCode =  igh1;
    } finally {
        await pool.end();
    }
})();