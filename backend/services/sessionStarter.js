// =============================================
// sessionStarter.js
// The SINGLE place where standup sessions are born.
// Only the scheduler calls this (directly or through
// the Teams orchestrator) - the web chat can join an
// existing session but can never create one.
//
//   scheduler cron -> runStandupForAllTeams()
//     -> startStandupForTeam() per team
//          - per-day guard (one session per team/day)
//          - fetch ADO work items per member
//          - snapshot new work items
//          - generate + save evening (EOD) questions
//          - onQuestionReady() callback for Teams cards
// =============================================

const {
    saveSession,
    getSession,
    updateSessionLifecycle,
} = require("./standupService");
const {
    saveQuestions,
} = require("./questionService");
const { saveWorkItem, refreshWorkItemSnapshot } = require("./workItemService");
const { generateDynamicQuestion } = require("./aiService");
const { getWorkItemByMember } = require("./workItemService");
const { getStandupConfigurations } = require("./standupService");
const pool = require("../db/postgres");

const DEFAULT_TIMEOUT_MINUTES =
    Number(process.env.STANDUP_TIMEOUT_MINUTES) || 30;

// EOD (default) = "What did you complete today on ...?"
// CLASSIC = the legacy three generic questions.
const QUESTION_MODE =
    String(process.env.STANDUP_QUESTION_MODE || "EOD").toUpperCase();

// =============================================
// TODAY'S SESSION FOR A TEAM (per-day guard)
// Standup runs once per day: any session created
// today (by the scheduler) is THE session.
// =============================================

async function getTodaySession(teamId) {
    const r = await pool.query(
        `SELECT * FROM standup_sessions
         WHERE team_id = $1
           AND standup_date::date = CURRENT_DATE
         ORDER BY id DESC
         LIMIT 1`,
        [teamId]
    );
    return r.rows[0] || null;
}

// =============================================
// EVENING / EOD QUESTION TEXT
// AI-generated from the ticket with an evening
// phrasing prompt; deterministic fallback when
// Groq is unavailable.
// =============================================

async function buildQuestionText(item) {
    const ticketLabel = item.external_ticket_id || item.id;

    if (QUESTION_MODE !== "CLASSIC") {
        try {
            const text = await generateDynamicQuestion(
                "Ticket " + ticketLabel + " - " + item.title +
                " (State: " + item.state + "). " +
                "This is an END-OF-DAY standup: ask the member " +
                "what they completed today on this ticket."
            );
            if (text && text.trim()) {
                return text.trim();
            }
        } catch (e) {
            // fall through to deterministic question
        }
    }

    return "What did you complete today on " + ticketLabel +
        " (" + item.title + ", " + item.state + ")?";
}

// =============================================
// SNAPSHOT A WORK ITEM (first time we see it)
// ADO ticket ids are external; the DB id is needed
// to link questions -> work_items.
// =============================================

async function ensureWorkItemDbId(item, memberId) {
    if (item.db_id) {
        // The snapshot row already exists, but it was written the
        // first time this ticket was ever seen, so its state/title/
        // day counters can be days or weeks old. Push the live Azure
        // DevOps values we just fetched over it, otherwise the PDF
        // report and every question keep mentioning a stale state.
        try {
            await refreshWorkItemSnapshot(item);
        } catch (e) {
            console.error(
                "sessionStarter: snapshot refresh failed for ticket " +
                item.id + ":", e.message
            );
        }
        return item.db_id;
    }
    const saved = await saveWorkItem({
        external_ticket_id: String(item.id),
        team_member_id: memberId,
        source_system: "azure-devops",
        title: item.title,
        state: item.state,
        priority: item.priority || null,
        inactive_days: item.days_inactive || 0,
        days_in_state: item.days_in_state || 0,
        last_updated: item.last_updated || null,
        state_changed: item.state_changed || null,
    });
    return saved.rows[0].id;
}
// =============================================
// START STANDUP FOR ONE TEAM
// Creates (or resumes) today's session, generates
// and saves evening questions for every active
// member. onQuestionReady() is called for every
// saved question so the Teams orchestrator can
// send its Adaptive Cards; the web chat path
// simply omits the callback.
// =============================================

async function startStandupForTeam(teamId, options = {}) {
    const onQuestionReady = options.onQuestionReady || null;

    // 1) Per-day guard: resume today's session if the
    //    scheduler already ran today.
    let session = await getTodaySession(teamId);
    if (session && session.lifecycle_status === "COMPLETED") {
        return { session: session, created: false };
    }

    if (!session) {
        session = await saveSession({
            team_id: teamId,
            standup_date: new Date(),
            status: "IN_PROGRESS",
            lifecycle_status: "STARTED",
        });
    }

    const sessionId = session.id;

    // 2) Timebox: questions_sent_at + response_deadline
    const mins = options.timeoutMinutes || DEFAULT_TIMEOUT_MINUTES;
    await updateSessionLifecycle(sessionId, "QUESTIONS_SENT", {
        questions_sent_at: new Date(),
        response_deadline: new Date(Date.now() + mins * 60 * 1000),
    });

    // 3) Questions for every active member of the team
    const membersRes = await pool.query(
        `SELECT id, name, email FROM team_members
         WHERE team_id = $1 AND is_active = true
         ORDER BY id ASC`,
        [teamId]
    );

    const savedQuestions = [];

    for (const member of membersRes.rows) {
        let items = [];
        try {
            items = await getWorkItemByMember(member.name);
        } catch (e) {
            console.error(
                "sessionStarter: work-item fetch failed for " +
                member.name + ":", e.message
            );
            items = [];
        }

        if (!items.length) {
            continue;
        }

        for (const item of items) {
            let workItemDbId = null;
            try {
                workItemDbId = await ensureWorkItemDbId(item, member.id);
            } catch (e) {
                console.error(
                    "sessionStarter: snapshot failed for ticket " +
                    item.id + ":", e.message
                );
                continue;
            }

            const text = await buildQuestionText(item);

            const saved = await saveQuestions({
                standup_session_id: sessionId,
                team_member_id: member.id,
                work_item_id: workItemDbId,
                question: text,
                asked_to: member.name,
            });

            const row = saved.rows[0];
            row.member_name = member.name;
            row.ticket_id = String(item.id);
            row.work_item_title = item.title;
            row.work_item_state = item.state;
            savedQuestions.push(row);

            if (onQuestionReady) {
                await onQuestionReady(row, item, member);
            }
        }
    }

    // 4) Waiting for answers
    await updateSessionLifecycle(sessionId, "WAITING_FOR_RESPONSES");
    session = await getSession(sessionId);

    return { session: session, created: true, questions: savedQuestions };
}

// =============================================
// RUN STANDUP FOR ALL CONFIGURED TEAMS
// Called by the scheduler (cron) - the ONLY
// entry point that creates sessions. Teams-card
// sending stays optional (onQuestionReady).
// =============================================

async function runStandupForAllTeams(options = {}) {
    const configurations = await getStandupConfigurations();

    if (!configurations.length) {
        console.log("sessionStarter: no standup configurations found.");
        return [];
    }

    // Group by team
    const teams = new Map();
    for (const config of configurations) {
        if (!teams.has(config.team_id)) {
            teams.set(config.team_id, {
                teamId: config.team_id,
                teamName: config.team_name,
                timeoutMinutes:
                    config.response_timeout_minutes ||
                    DEFAULT_TIMEOUT_MINUTES,
            });
        }
    }

    const results = [];

    for (const team of teams.values()) {
        try {
            const result = await startStandupForTeam(team.teamId, {
                timeoutMinutes: team.timeoutMinutes,
                onQuestionReady: options.onQuestionReady || null,
            });
            results.push({
                teamId: team.teamId,
                teamName: team.teamName,
                sessionId: result.session ? result.session.id : null,
                created: result.created,
            });
        } catch (e) {
            console.error(
                "sessionStarter: standup failed for team " +
                team.teamName + ":", e.message
            );
            results.push({
                teamId: team.teamId,
                teamName: team.teamName,
                error: e.message,
            });
        }
    }

    return results;
}

module.exports = {
    getTodaySession,
    startStandupForTeam,
    runStandupForAllTeams,
};