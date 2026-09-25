const cron = require("node-cron");

const adapter = require("../adapter");

const {
    executeStandupWorkflow,
    resumeOrphanedSessions
} = require("../orchestrators/standupOrchestrator");

const {
    getConversationReference
} = require("../bot");

// =============================================
// STANDUP TRIGGER (shared by cron + auto-start)
// The guard ensures the workflow never overlaps.
// =============================================

let standupRunning = false;

async function startStandupInConversation() {

    if (standupRunning) {

        console.log(
            "Standup already running - skipping trigger."
        );

        return;
    }

    // =========================================
    // GET REAL CONVERSATION
    // =========================================

    const conversationReference =
        getConversationReference();

    if (!conversationReference) {

        console.log(
            "No active conversation found yet."
        );

        return;
    }

    standupRunning = true;

    try {

        console.log(
            "Triggering standup workflow..."
        );

        // =========================================
        // CONTINUE REAL CONVERSATION
        // =========================================

        await adapter.continueConversationAsync(
            process.env.MicrosoftAppId,
            conversationReference,

            async (context) => {

                await context.sendActivity(
                    "Starting scheduled standup..."
                );

                await executeStandupWorkflow(
                    context
                );
            }
        );

        console.log(
            "Standup workflow executed successfully."
        );

    } catch (error) {

        console.error(
            "Scheduler Error:",
            error
        );

    } finally {

        standupRunning = false;
    }
}

// =========================================
// AUTO-START (disabled by default)
// Standup is started ONLY by the configured
// scheduler. Set STANDUP_AUTOSTART_ON_BOOT=true
// to restore the legacy boot-time trigger.
// =========================================

const autoStartOnBoot =
    String(process.env.STANDUP_AUTOSTART_ON_BOOT || "false")
        .toLowerCase() === "true";

if (autoStartOnBoot) {
    let autoStartAttempt = 0;
    const autoStartTimer = setInterval(async () => {
        if (getConversationReference()) {
            clearInterval(autoStartTimer);
            console.log("Conversation ready - auto-starting standup.");
            await startStandupInConversation();
        } else if (++autoStartAttempt >= 30) {
            // Give up after ~60s and rely on the cron schedule.
            clearInterval(autoStartTimer);
        }
    }, 2000);
}

// =========================================
// SCHEDULE
// Standup runs ONCE PER DAY, EVENING ONLY,
// started ONLY by this scheduler (never
// manually). Configurable via STANDUP_CRON.
// Default: weekdays at 6:00 PM.
// For testing you can set STANDUP_CRON="* * * * *"
//
// When a Teams conversation is available the
// Adaptive-Card flow runs; otherwise the standup
// runs in WEB MODE - sessions + questions are
// created for the TeamPulse web chat to join.
// =========================================

const standupSchedule =
    process.env.STANDUP_CRON || "0 18 * * 1-5";

async function runScheduledStandup() {
    const conversationReference = getConversationReference();

    if (conversationReference) {
        await startStandupInConversation();
        return;
    }

    // WEB MODE: no Teams conversation yet - still
    // create today's sessions + questions so the
    // web chat can join them.
    try {
        const { runStandupForAllTeams } =
            require("../services/sessionStarter");

        console.log(
            "No Teams conversation - running standup in WEB MODE..."
        );

        const results = await runStandupForAllTeams();
        for (const r of results) {
            if (r.error) {
                console.error(
                    `Standup failed for ${ r.teamName }: ${ r.error }`
                );
            } else if (r.created) {
                console.log(
                    `Standup session ${ r.sessionId } created for ${ r.teamName }.`
                );
            } else {
                console.log(
                    `Standup already ran today for ${ r.teamName } - skipped.`
                );
            }
        }
    } catch (error) {
        console.error("Web-mode Standup Error:", error);
    }
}

console.log(
    `Standup Scheduler Started... cron: "${standupSchedule}" (evening, once per day)`
);

cron.schedule(
    standupSchedule,
    runScheduledStandup
);

// =========================================
// ORPHAN RECOVERY
// Re-arm the single response deadline for sessions
// left in WAITING_FOR_RESPONSES by a previous bot run
// (e.g. after a restart/crash).
// =========================================
resumeOrphanedSessions();