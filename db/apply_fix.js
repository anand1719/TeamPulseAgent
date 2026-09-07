// Applies db/fix_missing_tables.sql using the same
// postgres pool config as db/postgres.js
// Run: node db/apply_fix.js
const fs = require('fs');
const path = require('path');
const pool = require('./postgres');

(async () => {
    const sqlPath = path.join(__dirname, 'fix_missing_tables.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    try {
        await pool.query(sql);
        console.log('Missing tables created successfully.');
    } catch (err) {
        console.error('Error applying fix:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();