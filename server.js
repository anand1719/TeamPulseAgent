const express = require("express");

const app = express();

// NOTE: The standup scheduler is intentionally NOT required here.
// It is already loaded by index.js (the bot entry point), so requiring
// it again from server.js would trigger the standup cron twice per minute.

const standupRoutes =
    require("./routes/standupRoutes");

app.use(express.json());

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

app.listen(5000, () => {
    console.log("Server running on port 5000");
});