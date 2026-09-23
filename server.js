const express = require("express");

require("dotenv").config();

const app = express();

// NOTE: The standup scheduler is intentionally NOT required here.
// It is already loaded by index.js (the bot entry point), so requiring
// it again from server.js would trigger the standup cron twice per minute.

const standupRoutes =
    require("./routes/standupRoutes");

app.use(express.json());

// --- CORS for the Next.js web chat (team-pulse-web, http://localhost:3000) ---
const WEB_ORIGINS = (process.env.WEB_CHAT_ORIGINS || "http://localhost:3000")
    .split(",").map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && WEB_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

app.get("/api/health", (req, res) => {
    res.json({ success: true, service: "nextgen-standup-bot", time: new Date().toISOString() });
});

app.use("/api/standup", standupRoutes);


app.use("/api/work-items",
    require("./routes/workItemRoutes"));

// app.use("/api/standup",
//     require("./routes/session"));

app.use("/api/questions",
    require("./routes/questionRoutes"));

app.use("/api/insights",
    require("./routes/insightRoutes"));

app.use("/api/teams",
    require("./routes/teamRoutes"));

app.use("/api/escalations",
    require("./routes/escalationRoutes"));

app.use("/api/responses",
    require("./routes/responseRoutes"));

app.use("/api/reports",
    require("./routes/reportRoutes"));

// Web-chat API for the TeamPulse Next.js frontend.
app.use("/api/web-chat",
    require("./routes/webChatRoutes"));

const PORT = process.env.API_PORT || 5000;
const httpServer = app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
httpServer.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Stop the other "node server.js" process (or press Shift+F5 + kill old terminals), then retry.`);
    } else {
        console.error("Server listen error:", err);
    }
    process.exitCode = 1;
});