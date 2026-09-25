const { Pool } = require("pg");

const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "Smart_Standup",
    password: "PostgresSql@123",
    port: 5433
});

module.exports = pool;