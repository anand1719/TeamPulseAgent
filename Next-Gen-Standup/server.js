const express = require("express");

const app = express();

require("./schedular/standupScheduler");

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

app.use("/api/escalations",
    require("./routes/escalationRoutes"));

app.use("/api/reports",
    require("./routes/reportRoutes"));


    app.use("/api/teams",
    require("./routes/teamRoutes"));
        
app.listen(5000, () => {
    console.log("Server running on port 5000");
});