// =============================================
// standupOrchestrator.js
// State-machine driven standup workflow:
//
//   STARTED -> QUESTIONS_SENT -> WAITING_FOR_RESPONSES
//     -> RESPONSES_RECEIVED -> AI_PROCESSING
//     -> INSIGHTS_GENERATED -> [ESCALATION] -> COMPLETED
//
// Questions are sent as Adaptive Cards (input + status
// buttons + deadline/consequence footer). The bot then waits
// for the configured single response deadline.- No reminder
// messages.- If not all questions are answered when the deadline
// hits, the remaining ones are marked NO_RESPONSE and the
// standup still finalizes (partial data + escalation).
// =============================================

const axios = require("axios");
const adapter = require("../adapter");
const {
    generateDynamicQuestion,
    analyzeResponse,
    generateSessionInsights,
    assessSessionEscalation
} = require("../services/aiService");
const {
    saveSession,
    getSession,
    updateSessionLifecycle,
    getSessionProgress
} = require("../services/standupService");
const {
    saveQuestions,
    getSessionQuestions,
    getOpenQuestionForMember,
    markQuestionAnswered,
    markPendingQuestionsNoResponse
} = require("../services/questionService");
const {
    saveUserResponse
} = require("../services/responseService");
const {
    generateStandupInsights
} = require("../services/insightService");
const {
    getReport
} = require("../services/reportService");
const {
    addEscalation
} = require("../services/escalationService");
const {
    buildQuestionCard,
    buildSummaryCard,
    buildEscalationNoticeCard
} = require("../services/adaptiveCardService");

const DEFAULT_TIMEOUT_MINUTES =
    Number(process.env.STANDUP_TIMEOUT_MINUTES) || 30;

// Guards against multiple overlapping standup runs
// (scheduler., auto-start,, and manual "run standup" triggers).
let standupRunning = false;

// In-memory timers per session. On bot restart,the
// schedular calls resumeOrphanedSessions() to re-arm
// the single deadline for sessions stuck in WAITING_FOR_RESPONSES.
const sessionTimers = new Map();

const API_BASE = process.env.API_BASE_URL || "http://localhost:5000";
const CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";

function sendCard(context, card) {
    return context.sendActivity({
        attachments: [{
            contentType: CARD_CONTENT_TYPE,
            content: card
        }]
    });
}

function attachmentFor(card) {
    return {
        contentType: CARD_CONTENT_TYPE,
        content: card
    };
}

// =============================================
// PER-TEAM STANDUP EXECUTION (kick-off)
// =============================================
async function executeStandupWorkflow(context) {
    if (standupRunning) {
        await context.sendActivity("Standup is already in progress.");
        return;
    }

    standupRunning = true;

    try {
        await context.sendActivity("Starting Next-Gen Smart Standup...");

        // STEP 1 - FETCH STANDUP CONFIGURATIONS
        let configurationResponse;
        try {
            configurationResponse = await axios.get(
                `${ API_BASE }/api/standup/configurations`);
        } catch (error) {
            console.error("Configuration API Error:", error.message);
            await context.sendActivity("Failed to fetch standup configurations.");
            return;
        }

        const configurations = configurationResponse.data.data;
        if (!configurations || !configurations.length) {
            await context.sendActivity("No standup configurations found.");
            return;
        }

        // STEP 2 - GROUP MEMBERS BY TEAM
        const groupedTeams = {};
        for (const config of configurations) {
            const teamId = config.team_id;
            if (!groupedTeams[teamId]) {
                groupedTeams[teamId] = {
                    team_name: config.team_name,
                    escalation_enabled: config.escalation_enabled,
                    response_timeout_minutes: config.response_timeout_minutes || DEFAULT_TIMEOUT_MINUTES,
                    members: []
                };
            }
            groupedTeams[teamId].members.push({
                member_id: config.member_id,
                member_name: config.name,
                email: config.email,
                role: config.role,
                teams_user_id: config.teams_user_id
            });
        }

        // STEP 3 - ITERATE TEAMS
        for (const teamId in groupedTeams) {
            const team = groupedTeams[teamId];
            await context.sendActivity(`Processing Team: ${ team.team_name }`);

            const timeoutMinutes = team.response_timeout_minutes || DEFAULT_TIMEOUT_MINUTES;

            // STEP 3a - CREATE SESSION (state STARTED)
            let session;
            try {
                session = await saveSession({
                    team_id: teamId,
                    standup_date: new Date(),
                    status: "IN_PROGRESS",
                    lifecycle_status: "STARTED"
                });
            } catch (error) {
                console.error(`Standup Session API Error for Team ${ team.team_name }:`, error.response?.data || error.message);
                await context.sendActivity(`Failed to create standup session for ${ team.team_name }`);
                continue;
            }

            const sessionId = session.id;
            console.log(`Standup Session Created: ${ sessionId }`);
            await updateSessionLifecycle(sessionId, "QUESTIONS_SENT", {
                questions_sent_at: new Date(),
                response_deadline: new Date(Date.now() + timeoutMinutes * 60 * 1000)
            });

            // STEP 4 - ITERATE MEMBERS -> WORK ITEMS -> GENERATE/SAVE/SEND CARDS
            for (const member of team.members) {
                const memberId = member.member_id;
                const memberName = member.member_name;

                let workItemResponse;
                try {
                    workItemResponse = await axios.get(
                        `${ API_BASE }/api/work-items/${ encodeURIComponent(memberName) }`);
                } catch (error) {
                    console.error(`Work Item API Error for ${ memberName }:`, error.message);
                    await context.sendActivity(`Failed to fetch work items for ${ memberName }`);
                    continue;
                }

                const workItems = workItemResponse.data;
                if (!workItems || !workItems.length) {
                    await context.sendActivity(`No work items found for ${ memberName }`);
                    continue;
                }

                for (const item of workItems) {
                    // Build ticket details for AI question generation
                    const ticketDetails = `
                        Ticket ID: ${ item.id }
                        Title: ${ item.title }
                        State: ${ item.state }
                        Assigned To: ${ memberName }
                        Last Updated: ${ item.last_updated }
                    `;

                    // STEP 4a - GENERATE AI QUESTION
                    let question;
                    try {
                        question = await generateDynamicQuestion(ticketDetails);
                    } catch (error) {
                        console.error(`AI Question Generation Error for Ticket ${ item.id }:`, error.message);
                        await context.sendActivity(`AI failed to generate question for Ticket ${ item.id }`);
                        continue;
                    }

                    if (!question || typeof question !== "string" || !question.trim()) {
                        question = `What is the current progress and any blockers on Ticket ${ item.id } (${ item.title })?`;
                    }

                    // STEP 4b - RESOLVE DB WORK ITEM ID (snapshot if needed)
                    let workItemDbId = item.db_id;
                    try {
                        if (!workItemDbId) {
                            const snapshotResponse = await axios.post(
                                `${ API_BASE }/api/work-items`,
                                {
                                    external_ticket_id: String(item.id),
                                    team_member_id: memberId,
                                    source_system: "azure-devops",
                                    title: item.title,
                                    state: item.state
                                });
                            workItemDbId = snapshotResponse.data.id;
                        }

                        // STEP 4c - SAVE QUESTION (status PENDING)
                        const questionResult = await saveQuestions({
                            standup_session_id: sessionId,
                            team_member_id: memberId,
                            work_item_id: workItemDbId,
                            question,
                            asked_to: memberName
                        });
                        const questionId = questionResult.rows[0].id;

                        // STEP 4d - SEND ADAPTIVE CARD (deadline + consequence in-card)
                        const card = buildQuestionCard({
                            memberName,
                            questionId,
                            ticketLabel: item.id,
                            title: item.title,
                            state: item.state,
                            inactiveDays: item.days_inactive || 0,
                            question,
                            timeoutMinutes
                        });
                        await sendCard(context, card);
                    } catch (error) {
                        console.error(`Save/Send Question Error for Ticket ${ item.id }:`, error.message);
                        await context.sendActivity(`Failed to save question for Ticket ${ item.id }`);
                    }
                }
            }

            // STEP 5 - ENTER WAITING_FOR_RESPONSES + ARM THE SINGLE DEADLINE TIMER
            const progress = await getSessionProgress(sessionId);
            if (progress.allAnswered) {
                await finalizeStandup(sessionId, context);
            } else {
                await updateSessionLifecycle(sessionId, "WAITING_FOR_RESPONSES");
                armDeadlineTimer(sessionId, timeoutMinutes);
            }
        }
    } catch (error) {
        console.error("Standup Workflow Error:", error.message);
        await context.sendActivity("Error executing standup workflow.");
    } finally {
        standupRunning = false;
    }
}

// =============================================
// SINGLE DEADLINE TIMER (no reminders)
// When the deadline fires for a session still in
// WAITING_FOR_RESPONSES, the remaining PENDING
// questions become NO_RESPONSE, then the standup
// finalizes (AI processing + insights + report,
// with escalation for risks/no-responses when enabled).
// =============================================
function armDeadlineTimer(sessionId, timeoutMinutes) {
    if (sessionTimers.has(sessionId)) {
        clearTimeout(sessionTimers.get(sessionId));
    }
    const timer = setTimeout(async () => {
        sessionTimers.delete(sessionId);
        try {
            const session = await getSession(sessionId);
            if (!session || session.lifecycle_status !== "WAITING_FOR_RESPONSES") {
                return;
            }
            const progress = await getSessionProgress(sessionId);
            if (progress.allAnswered) {
                return;
            }
            console.log(`Standup ${ sessionId } deadline reached - finalizing.`);
            await finalizeStandup(sessionId);
        } catch (error) {
            console.error(`Standup deadline handler Error for ${ sessionId }:`, error.message);
        }
    }, timeoutMinutes * 60 * 1000);
    sessionTimers.set(sessionId, timer);
}

// =============================================
// HANDLE A USER RESPONSE (card submit or typed)
// Flow: Save Response -> AI Processing -> Context
// Enrichment -> Risk/Decision Engine -> (per-response
// escalation) -> mark ANSWERED -> if session complete
// (received) then finalize (early-exit, no waiting).
// =============================================
async function handleUserResponse(context, questionId, userText, statusLabel) {
    if (!questionId) {
        return false;
    }

    const questionRows = await getSessionQuestionsByQuestionId(questionId);
    const q = (questionRows || []).find(r => r.id === Number(questionId));
    if (!q) {
        return false;
    }

    const session = await getSession(q.standup_session_id);
    if (!session || session.lifecycle_status === "COMPLETED") {
        return false;
    }

    // Ignore replies to questions already answered
    if (q.question_status === "ANSWERED") {
        await context.sendActivity("You already answered this question. Thanks!");
        return true;
    }

    // Determine the response text: button click (status
    // label as the answer) or typed input.
    const responseText = (userText && String(userText).trim())
        ? String(userText).trim()
        : (statusLabel ? `Status: ${ statusLabel }` : "");

    if (!responseText) {
        await context.sendActivity("Please type your update in the card, or click a status button.");
        return true;
    }

    const contextText = [
        q.work_item_title,
        q.work_item_state
    ].filter(Boolean).join(" - ");

    // STEP 1 - AI PROCESSING (sentiment, blocker, risk)?
    const analysis = await analyzeResponse(responseText, contextText);

    // STEP 2 - SAVE RESPONSE (with risk flags)
    await saveUserResponse({
        standup_question_id: q.id,
        response: responseText,
        sentiment: analysis.sentiment,
        blocker_detected: analysis.blocker_detected,
        response_type: statusLabel ? "BUTTON" : "TEXT",
        risk_detected: analysis.risk_detected,
        risk_reason: analysis.risk_reason
    });

    // STEP 3 - MARK QUESTION ANSWERED
    await markQuestionAnswered(q.id);

    await context.sendActivity(
        `Thanks ${ q.member_name }, your update was saved (${ q.ticket_id || "work item" } - ${ q.work_item_title || "" }).`
    );

    // STEP 4 - EARLY FINALIZE WHEN ALL ANSWERED
    const progress = await getSessionProgress(q.standup_session_id);
    if (progress.allAnswered) {
        const sessionState = await getSession(q.standup_session_id);
        if (sessionState && sessionState.lifecycle_status === "WAITING_FOR_RESPONSES") {
            console.log(`All responses received for session ${ q.standup_session_id } - finalizing early.`);
            await updateSessionLifecycle(q.standup_session_id, "RESPONSES_RECEIVED");
            await finalizeStandup(q.standup_session_id);
        }
    }

    return true;
}

async function getSessionQuestionsByQuestionId(questionId) {
    const pool = require("../db/postgres");
    const result = await pool.query(
        `SELECT
            sq.id,
            sq.standup_session_id,
            sq.team_member_id,
            sq.question_status,
            sq.asked_to,
            tm.name AS member_name,
            tm.email AS member_email,
            tm.teams_user_id,
            wi.external_ticket_id AS ticket_id,
            wi.title AS work_item_title,
            wi.state AS work_item_state,
            wi.inactive_days
        FROM standup_questions sq
        INNER JOIN team_members tm ON tm.id = sq.team_member_id
        LEFT JOIN work_items wi ON wi.id = sq.work_item_id
        WHERE sq.id = $1`,
        [questionId]
    );
    return result.rows;
}

// =============================================
// PROACTIVE SEND (for deadline-driven finalize)
// When the deadline fires there is no inbound turn
// context, so we continue the saved conversation
// (if any). IMPORTANT: a Bot Framework context is
// only valid INSIDE its turn callback - the proxy is
// revoked when the callback ends. So the cards must
// be sent inside the callback, never captured and
// used afterwards. If no reference is available we
// return false and skip card sends (data persistence
// still happens).
// =============================================
async function runInProactiveContext(sendActions) {
    try {
        const { getConversationReference } = require("../bot");
        const conversationReference = getConversationReference();
        if (!conversationReference) {
            return false;
        }
        let ran = false;
        await adapter.continueConversationAsync(
            process.env.MicrosoftAppId,
            conversationReference,
            async (ctx) => {
                ran = true;
                await sendActions(ctx);
            }
        );
        return ran;
    } catch (error) {
        console.error("runInProactiveContext Error:", error.message);
        return false;
    }
}

// =============================================
// FINALIZE A STANDUP SESSION
// RESPONSES_RECEIVED -> AI_PROCESSING -> INSIGHTS_GENERATED
//   -> (ESCALATION if risk/no-response) -> report -> COMPLETED
// =============================================
async function finalizeStandup(sessionId, context) {
    const session = await getSession(sessionId);
    const cardsToSend = [];
    if (!session) {
        return;
    }
    if (session.lifecycle_status === "COMPLETED" || session.lifecycle_status === "AI_PROCESSING") {
        return;
    }

    // 1) Mark any still-pending questions NO_RESPONSE (deadline path)
    await markPendingQuestionsNoResponse(sessionId);

    // 2) AI PROCESSING + CONTEXT ENRICHMENT (joined rows)
    await updateSessionLifecycle(sessionId, "AI_PROCESSING");
    const rows = await getSessionQuestions(sessionId);

    // 3) INSIGHTS_GENERATED (targeted session, gated on questions existing)
    const insight = await generateStandupInsights(sessionId);
    await updateSessionLifecycle(sessionId, "INSIGHTS_GENERATED");

    // 4) RISK / DECISION ENGINE -> ESCALATION
    //    Only when escalation_enabled for the team.
    if (session.escalation_enabled) {
        const assessment = assessSessionEscalation(rows);
        if (assessment.escalated) {
            await updateSessionLifecycle(sessionId, "ESCALATION");
            for (const row of rows) {
                if ((row.question_status === "NO_RESPONSE" || row.blocker_detected || row.risk_detected) && row.work_item_id) {
                    try {
                        await addEscalation({
                            work_item_id: row.work_item_id,
                            team_member_id: row.team_member_id,
                            severity: row.blocker_detected ? "HIGH" : (row.question_status === "NO_RESPONSE" ? "HIGH" : "MEDIUM"),
                            escalation_reason: assessment.escalationReasons.find(r => r.includes(row.member_name)) || "Standup risk flagged.",
                            notified_to: row.member_email || null
                        });
                    } catch (error) {
                        console.error(`Escalation Error for ${ row.member_name }:`, error.message);
                    }
                }
            }
            cardsToSend.push(buildEscalationNoticeCard({
                    memberName: "Standup",
                    severity: assessment.severity,
                    reason: assessment.escalationReasons.join(" | ")
            }));
        }
    }

    // 5) REPORT(insights summary card to Teams)
    const report = await getReport(sessionId);
    if (report && report.rows[0]) {
        cardsToSend.push(buildSummaryCard({
            teamName: session.team_name,
            sessionId,
            summary: report.rows[0].summary,
            blockers: (report.rows[0].blockers || "").split(" | ").filter(Boolean),
            risks: (report.rows[0].risks || "").split(" | ").filter(Boolean),
            recommendations: (report.rows[0].recommendations || "").split(" | ").filter(Boolean),
            sentiment: report.rows[0].sentiment
        }));
    }

    if (cardsToSend.length) {
        if (context) {
            for (const card of cardsToSend) {
                await sendCard(context, card);
            }
        } else {
            await runInProactiveContext(async (ctx) => {
                for (const card of cardsToSend) {
                    await sendCard(ctx, card);
                }
            });
        }
    }

    // 6) COMPLETED (the ONLY place the "completed" is logged)
    await updateSessionLifecycle(sessionId, "COMPLETED");
    console.log(`Standup session ${ sessionId } completed successfully.`);
    if (sessionTimers.has(sessionId)) {
        clearTimeout(sessionTimers.get(sessionId));
        sessionTimers.delete(sessionId);
    }
}

// =============================================
// RESUME ORPHANED SESSIONS (boot-time recovery)
// Re-arms the single deadline for sessions stuck in
// WAITING_FOR_RESPONSES after a bot restart.
// =============================================
async function resumeOrphanedSessions() {
    try {
        const pool = require("../db/postgres");
        const result = await pool.query(
            `SELECT id, response_deadline
             FROM standup_sessions
             WHERE lifecycle_status = 'WAITING_FOR_RESPONSES'
               AND response_deadline IS NOT NULL`
        );
        for (const row of result.rows) {
            const timeoutMinutes = Math.max(
                1,
                Math.ceil((new Date(row.response_deadline) - Date.now()) / 60000)
            );
            console.log(`Resuming standup session ${ row.id } deadline (${ timeoutMinutes } min left).`);
            armDeadlineTimer(row.id, timeoutMinutes);
        }
        if (!result.rows.length) {
            console.log("No orphaned standup sessions to resume.");
        }
    } catch (error) {
        console.error("resumeOrphanedSessions Error:", error.message);
    }
}

module.exports = {
    executeStandupWorkflow,
    handleUserResponse,
    resumeOrphanedSessions
};










