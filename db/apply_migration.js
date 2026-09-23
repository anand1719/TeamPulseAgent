// Applies a SQL migration file from db/ using the same
// postgres pool config as db/postgres.js.
// Run: node db/apply_migration.js [migrationFile.sql]
//      (defaults to standup_state_migration.sql)
const fs = require('fs');
const path = require('path');
const pool = require('./postgres');

(async () => {
    const fileName = process.argv[2] || 'standup_state_migration.sql';
    const sqlPath = path.join(__dirname, fileName);

    if (!fs.existsSync(sqlPath)) {
        console.error('Migration file not found: ' + sqlPath);
        process.exitCode = 1;
        await pool.end();
        return;
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');

    try {
        await pool.query(sql);
        console.log('Migration applied successfully: ' + fileName);
    } catch (err) {
        console.error('Error applying migration:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();