const cron = require("node-cron");

const adapter = require("../adapter");

const {
    executeStandupWorkflow
} = require("../orchestrators/standupOrchestrator");

const {
    getConversationReference
} = require("../bot");

console.log(
    "Standup Scheduler Started..."
);

// Every minute for testing

cron.schedule("* * * * *", async () => {

    try {

        console.log(
            "Triggering standup workflow..."
        );

        // =========================================
        // GET REAL CONVERSATION
        // =========================================

        const conversationReference =
            getConversationReference();

        if (!conversationReference) {

            console.log(
                "No active Emulator conversation found."
            );

            console.log(
                "Send a message from Emulator first."
            );

            return;
        }

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
    }
});