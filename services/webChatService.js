// =============================================
// webChatService.js
// Pure (no Teams context) standup workflow for the
// TeamPulse web chat (team-pulse-web chat.tsx).
//
// JOIN-ONLY: sessions are created exclusively by the
// configured scheduler (services/sessionStarter.js).
// The web chat resolves today's session and joins it;
// if the scheduler has not run yet, bootstrap reports
// a "scheduled" state instead of creating anything.
//
// On session completion the service also PROPOSES
// Azure DevOps work-item updates (status + comment)
// which the user can confirm to push to the board.
// =============================================

const {
    getSession,
    getSessionProgress,
    updateSessionLifecycle,
} = require("./standupService");
const { getSessionQuestions } = require("./questionService");
const { saveUserResponse } = require("./responseService");
const { generateStandupInsights } = require("./insightService");
const { getReport } = require("./reportService");
const {
    analyzeResponse,
    proposeWorkItemUpdates,
} = require("./aiService");
const { getWorkItemByMember, applyWorkItemState } = require("./workItemService");
const {
    addWorkItemComment,
    updateWorkItemState,
} = require("./azureDevopsService");
const { getTodaySession } = require("./sessionStarter");
const pool = require("../db/postgres");

const DEFAULT_CRON = process.env.STANDUP_CRON || "0 18 * * 1-5";

function err404(msg) {
    const e = new Error(msg);
    e.statusCode = 404;
    return e;
}

// =============================================
// MEMBER / TEAM RESOLUTION
// =============================================

async function resolveMember(memberName, teamId) {
    if (teamId) {
        const r = await pool.query(
            "SELECT tm.*, t.team_name FROM team_members tm " +
            "INNER JOIN teams t ON t.id = tm.team_id " +
            "WHERE tm.team_id = $1 " +
            "AND (LOWER(tm.name) = LOWER($2) OR LOWER(tm.email) = LOWER($2)) LIMIT 1",
            [teamId, String(memberName || "")]
        );
        if (r.rows[0]) return r.rows[0];
        const fb = await pool.query(
            "SELECT tm.*, t.team_name FROM team_members tm " +
            "INNER JOIN teams t ON t.id = tm.team_id " +
            "WHERE tm.team_id = $1 ORDER BY tm.id ASC LIMIT 1",
            [teamId]
        );
        if (fb.rows[0]) return fb.rows[0];
    }
    const r = await pool.query(
        "SELECT tm.*, t.team_name FROM team_members tm " +
        "INNER JOIN teams t ON t.id = tm.team_id " +
        "WHERE LOWER(tm.name) = LOWER($1) OR LOWER(tm.email) = LOWER($1) " +
        "ORDER BY tm.id ASC LIMIT 1",
        [String(memberName || "")]
    );
    return r.rows[0] || null;
}

async function getTeamWithMembers(teamId) {
    const teamRes = await pool.query("SELECT * FROM teams WHERE id = $1", [teamId]);
    const membersRes = await pool.query(
        "SELECT id, team_id, name, email, role FROM team_members WHERE team_id = $1 ORDER BY id ASC",
        [teamId]
    );
    return { team: teamRes.rows[0] || null, members: membersRes.rows };
}

// =============================================
// SCHEDULE INFO
// The standup runs once per day in the evening,
// started ONLY by the configured scheduler.
// =============================================

async function getScheduleInfo(teamId) {
    let scheduleTime = "18:00:00";
    if (teamId) {
        const r = await pool.query(
            "SELECT schedule_time FROM teams WHERE id = $1",
            [teamId]
        );
        if (r.rows[0] && r.rows[0].schedule_time) {
            scheduleTime = String(r.rows[0].schedule_time).slice(0, 8);
        }
    }
    return {
        cron: DEFAULT_CRON,
        scheduleTime: scheduleTime,
        startedBy: "scheduler",
    };
}

// =============================================
// BOOTSTRAP (JOIN-ONLY)
// Resolves the member + team, finds TODAY'S session
// created by the scheduler and joins it. Never
// creates a session.
// =============================================

async function bootstrapWebSession(opts) {
    opts = opts || {};
    let teamId = opts.teamId ? Number(opts.teamId) : null;
    const memberName = opts.memberName || null;
    let team = null;
    let members = [];
    let member = null;

    if (teamId) {
        const t = await getTeamWithMembers(teamId);
        team = t.team;
        members = t.members;
        if (!team) throw err404("Team not found");
        member = memberName ? await resolveMember(memberName, teamId) : members[0];
        if (!member) throw err404("No members found for team");
    } else if (memberName) {
        member = await resolveMember(memberName, null);
        if (!member) throw err404('Member "' + memberName + '" not found');
        teamId = member.team_id;
        const t = await getTeamWithMembers(teamId);
        team = t.team;
        members = t.members;
    } else {
        const teamsRes = await pool.query(
            "SELECT * FROM teams ORDER BY id ASC LIMIT 1"
        );
        team = teamsRes.rows[0];
        if (!team) throw err404("No teams configured");
        teamId = team.id;
        const t = await getTeamWithMembers(teamId);
        members = t.members;
        member = members[0];
    }

    const schedule = await getScheduleInfo(teamId);

    // TODAY'S session only (created by the scheduler).
    const session = await getTodaySession(teamId);

    let workItems = [];
    try {
        workItems = await getWorkItemByMember(member.name);
    } catch (e) { workItems = []; }

    if (!session) {
        // The scheduler has not started today's standup yet.
        return {
            standupScheduled: false,
            schedule: schedule,
            team: team,
            members: members,
            member: member,
            session: null,
            questions: [],
            workItems: workItems,
            progress: { total: 0, answered: 0, noResponse: 0, allAnswered: false },
        };
    }

    const questions = await getSessionQuestions(session.id);

    // Scope to the current member when the session
    // covers several members.
    let visible = questions;
    if (member) {
        const scoped = questions.filter(function (q) {
            return String(q.member_name || "").toLowerCase() ===
                String(member.name || "").toLowerCase();
        });
        if (scoped.length) visible = scoped;
    }

    const progress = await getSessionProgress(session.id);
    const completed = session.lifecycle_status === "COMPLETED" ||
        session.status === "COMPLETED";

    let proposals = [];
    if (completed) {
        proposals = await getAdoProposals(session.id);
    }

    return {
        standupScheduled: true,
        schedule: schedule,
        sessionCompleted: completed,
        team: team,
        members: members,
        member: member,
        session: session,
        questions: visible,
        workItems: workItems,
        progress: progress,
        adoProposals: proposals,
    };
}

// =============================================
// SINGLE QUESTION (joined, for the answer flow)
// =============================================

async function getOneQuestion(questionId) {
    const r = await pool.query(
        "SELECT sq.id, sq.standup_session_id, sq.team_member_id, sq.work_item_id, " +
        "sq.question, sq.asked_to, sq.question_status, sq.answered_at, " +
        "tm.name AS member_name, tm.email AS member_email, " +
        "wi.external_ticket_id AS ticket_id, wi.title AS work_item_title, wi.state AS work_item_state " +
        "FROM standup_questions sq " +
        "INNER JOIN team_members tm ON tm.id = sq.team_member_id " +
        "LEFT JOIN work_items wi ON wi.id = sq.work_item_id WHERE sq.id = $1",
        [questionId]
    );
    return r.rows;
}

// =============================================
// ANSWER A QUESTION
// Saves the reply + AI analysis, advances to the
// next pending question and, when everything is
// answered, finalizes the session: AI insights +
// PROPOSED Azure DevOps updates (persisted, not
// pushed until the user confirms).
// =============================================

async function answerWebQuestion(questionId, body) {
    body = body || {};
    const rows = await getOneQuestion(Number(questionId));
    const q = rows[0];
    if (!q) throw err404("Question not found");
    if (q.question_status === "ANSWERED") {
        return { alreadyAnswered: true, question: q };
    }
    const session = await getSession(q.standup_session_id);
    if (!session || session.lifecycle_status === "COMPLETED") {
        const e = new Error("Session is already completed");
        e.statusCode = 409;
        throw e;
    }
    const commentText = String(body.response || "").trim();
    const statusText = String(body.status || "").trim();
    if (!commentText && !statusText) {
        const e = new Error("Response text is required");
        e.statusCode = 400;
        throw e;
    }
    const responseText = statusText
        ? (commentText ? "Status: " + statusText + " | " + commentText : "Status: " + statusText)
        : commentText;
    const ctx = [q.work_item_title, q.work_item_state].filter(Boolean).join(" - ");
    const analysis = await analyzeResponse(responseText, ctx);
    const saved = await saveUserResponse({
        standup_question_id: q.id,
        response: responseText,
        sentiment: analysis.sentiment,
        blocker_detected: analysis.blocker_detected,
        response_type: statusText ? (commentText ? "STATUS_TEXT" : "STATUS") : "TEXT",
        risk_detected: analysis.risk_detected,
        risk_reason: analysis.risk_reason,
    });
    await pool.query(
        "UPDATE standup_questions SET question_status = 'ANSWERED', answered_at = NOW() WHERE id = $1",
        [q.id]
    );
    const all = await getSessionQuestions(q.standup_session_id);
    const pending = all.filter(function (r) {
        return r.question_status === "PENDING" && r.team_member_id === q.team_member_id;
    });
    const nextQuestion = pending.length ? pending[0] : null;
    const progress = await getSessionProgress(q.standup_session_id);
    let summary = null;
    let proposals = [];
    let completed = false;
    if (progress.allAnswered) {
        await updateSessionLifecycle(q.standup_session_id, "RESPONSES_RECEIVED");
        try {
            summary = await generateStandupInsights(q.standup_session_id);
        } catch (e) { console.error("webChat: insights failed:", e.message); }
        await updateSessionLifecycle(q.standup_session_id, "COMPLETED");
        completed = true;
        if (!summary) {
            const rep = await getReport(q.standup_session_id);
            summary = rep && rep.rows ? rep.rows[0] : null;
        }
        // PROPOSE Azure DevOps updates from the answers
        try {
            proposals = await createAdoProposals(q.standup_session_id);
        } catch (e) {
            console.error("webChat: ADO proposal generation failed:", e.message);
        }
    }
    return {
        savedResponse: saved.rows ? saved.rows[0] : saved,
        analysis: analysis,
        nextQuestion: nextQuestion,
        progress: progress,
        completed: completed,
        summary: summary,
        sessionId: q.standup_session_id,
        adoProposals: proposals,
    };
}

// =============================================
// ADO PROPOSALS - PERSIST
// Computes proposed updates from the session's
// answered ticket questions and stores them in
// ado_updates. Nothing is pushed to Azure DevOps
// here - that happens only on explicit confirm.
// =============================================

async function createAdoProposals(sessionId) {
    const rows = await getSessionQuestions(sessionId);
    const proposals = await proposeWorkItemUpdates(rows);
    if (!proposals.length) {
        return [];
    }
    // Replace any previous unapplied proposals for
    // this session (re-runs stay clean).
    await pool.query(
        "DELETE FROM ado_updates WHERE standup_session_id = $1 AND applied_at IS NULL",
        [sessionId]
    );
    const saved = [];
    for (const p of proposals) {
        const workItemRes = await pool.query(
            "SELECT id FROM work_items WHERE external_ticket_id = $1 LIMIT 1",
            [p.ticketId]
        );
        const insert = await pool.query(
            `INSERT INTO ado_updates
             (standup_session_id, work_item_id, external_ticket_id,
              proposed_status, proposed_comment)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                sessionId,
                workItemRes.rows[0] ? workItemRes.rows[0].id : null,
                p.ticketId,
                p.proposedStatus,
                p.comment,
            ]
        );
        const row = insert.rows[0];
        row.ticket_id = p.ticketId;
        row.title = p.title;
        row.current_state = p.currentState;
        saved.push(row);
    }
    return saved;
}

// =============================================
// ADO PROPOSALS - READ
// Returns stored proposals; if a completed session
// has none (e.g. completed before this feature),
// they are generated on demand.
// =============================================

async function getAdoProposals(sessionId) {
    const existing = await pool.query(
        "SELECT * FROM ado_updates WHERE standup_session_id = $1 ORDER BY id ASC",
        [sessionId]
    );
    if (existing.rows.length) {
        return existing.rows.map(r => ({
            ...r,
            applied: !!r.applied_at,
        }));
    }
    const session = await getSession(sessionId);
    if (!session || session.lifecycle_status !== "COMPLETED") {
        return [];
    }
    const created = await createAdoProposals(sessionId);
    return created.map(r => ({ ...r, applied: false }));
}

// =============================================
// ADO PROPOSALS - CONFIRM & PUSH
// Explicit user confirmation required. For each
// item: post the comment, optionally move the
// state. Per-ticket success/failure is persisted
// (apply_result) and returned.
// =============================================

async function confirmAdoUpdates(sessionId, updates) {
    const list = Array.isArray(updates) ? updates : [];
    if (!list.length) {
        const e = new Error("No updates provided");
        e.statusCode = 400;
        throw e;
    }
    const results = [];
    for (const u of list) {
        const updateId = Number(u.updateId);
        const status = String(u.status || "").trim();
        const comment = String(u.comment || "").trim();
        let row = null;
        if (updateId) {
            const r = await pool.query(
                "SELECT * FROM ado_updates WHERE id = $1 AND standup_session_id = $2",
                [updateId, sessionId]
            );
            row = r.rows[0];
        }
        if (!row && u.ticketId) {
            const r = await pool.query(
                "SELECT * FROM ado_updates WHERE external_ticket_id = $1 AND standup_session_id = $2",
                [String(u.ticketId), sessionId]
            );
            row = r.rows[0];
        }
        if (!row) {
            results.push({
                ticketId: u.ticketId || null,
                success: false,
                error: "Proposal not found for this session",
            });
            continue;
        }
        if (row.applied_at) {
            results.push({
                ticketId: row.external_ticket_id,
                success: true,
                alreadyApplied: true,
                status: row.applied_status,
            });
            continue;
        }
        const applyResult = {};
        let ok = true;
        let firstError = null;
        if (comment) {
            try {
                await addWorkItemComment(row.external_ticket_id, comment);
                applyResult.comment = { ok: true };
            } catch (e) {
                ok = false;
                applyResult.comment = {
                    ok: false,
                    error: e.response && e.response.data
                        ? JSON.stringify(e.response.data).slice(0, 300)
                        : e.message,
                };
                firstError = applyResult.comment.error;
            }
        }
        if (status) {
            try {
                await updateWorkItemState(row.external_ticket_id, status);
                applyResult.state = { ok: true, status: status };
            } catch (e) {
                ok = false;
                applyResult.state = {
                    ok: false,
                    error: e.response && e.response.data
                        ? JSON.stringify(e.response.data).slice(0, 300)
                        : e.message,
                };
                if (!firstError) firstError = applyResult.state.error;
            }
        }
        await pool.query(
            `UPDATE ado_updates
             SET applied_status = $1,
                 applied_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
                 apply_result = $3
             WHERE id = $4`,
            [
                ok && status ? status : null,
                ok,
                JSON.stringify(applyResult),
                row.id,
            ]
        );

        // The board is now ahead of the local snapshot, and the PDF
        // report / work-item views read work_items.state, so mirror
        // the applied status here as well. Best effort: the push to
        // Azure DevOps already succeeded, so a DB hiccup must not
        // fail the request.
        if (ok && status) {
            try {
                await applyWorkItemState(row.external_ticket_id, status);
            } catch (e) {
                console.error(
                    "confirmAdoUpdates: work_items sync failed for ticket " +
                    row.external_ticket_id + ":", e.message
                );
            }
        }
        results.push({
            ticketId: row.external_ticket_id,
            updateId: row.id,
            success: ok,
            status: ok ? status : null,
            error: ok ? null : firstError,
        });
    }
    return results;
}


// =============================================
// SESSION SUMMARY
// Insight + per-question recap + escalations +
// progress + (for completed sessions) the ADO
// proposals.
// =============================================

async function getSessionSummary(sessionId) {
    const session = await getSession(sessionId);
    if (!session) throw err404("Session not found");
    const questions = await getSessionQuestions(sessionId);
    const rep = await getReport(sessionId);
    const insight = rep && rep.rows ? rep.rows[0] : null;
    let escalations = [];
    try {
        const e = await pool.query(
            "SELECT e.*, tm.name AS member_name FROM escalations e " +
            "LEFT JOIN team_members tm ON tm.id = e.team_member_id " +
            "WHERE e.team_member_id IN " +
            "(SELECT team_member_id FROM standup_questions WHERE standup_session_id = $1) " +
            "ORDER BY e.id DESC LIMIT 20",
            [sessionId]
        );
        escalations = e.rows;
    } catch (err) { escalations = []; }
    const progress = await getSessionProgress(sessionId);
    let proposals = [];
    try {
        proposals = await getAdoProposals(sessionId);
    } catch (err) { proposals = []; }
    return {
        session: session,
        questions: questions,
        insight: insight,
        escalations: escalations,
        progress: progress,
        adoProposals: proposals,
    };
}

module.exports = {
    bootstrapWebSession,
    answerWebQuestion,
    confirmAdoUpdates,
    getAdoProposals,
    getSessionSummary,
    getTeamWithMembers,
    resolveMember,
    getScheduleInfo,
};

