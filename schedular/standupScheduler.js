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
// AUTO-START
// Starts the standup automatically when a
// conversation reference becomes available
// (no user message required). Polls for up
// to ~60 seconds after the app boots.
// =========================================

let autoStartAttempt = 0;

const autoStartTimer = setInterval(async () => {

    if (getConversationReference()) {

        clearInterval(autoStartTimer);

        console.log(
            "Conversation ready - auto-starting standup."
        );

        await startStandupInConversation();

    } else if (++autoStartAttempt >= 30) {

        // Give up after ~60s and rely on the cron schedule.
        clearInterval(autoStartTimer);
    }
}, 2000);

// =========================================
// SCHEDULE
// Configurable via STANDUP_CRON env var.
// Default: weekdays at 9:00 AM.
// For testing you can set STANDUP_CRON="* * * * *"
// =========================================

const standupSchedule =
    process.env.STANDUP_CRON || "0 9 * * 1-5";

console.log(
    `Standup Scheduler Started... cron: "${standupSchedule}"`
);

cron.schedule(
    standupSchedule,
    startStandupInConversation
);

// =========================================
// ORPHAN RECOVERY
// Re-arm the single response deadline for sessions
// left in WAITING_FOR_RESPONSES by a previous bot run
// (e.g. after a restart/crash).
// =========================================
resumeOrphanedSessions();