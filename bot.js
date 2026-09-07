const {
    ActivityHandler,
    TurnContext
} = require("botbuilder");

const {
    executeStandupWorkflow,
    handleUserResponse
} = require("./orchestrators/standupOrchestrator");

const {
    getActiveWaitingSessions
} = require("./services/standupService");

const {
    getOpenQuestionForMember
} = require("./services/questionService");

let savedConversationReference;

class MyBot extends ActivityHandler {
    constructor() {
        super();
        // =========================================
        // HANDLE USER MESSAGES (card submits + typed)
        // =========================================
        this.onMessage(async (context, next) => {
            // Save the conversation reference so the scheduler can auto-start.

            savedConversationReference =
                TurnContext.getConversationReference(context.activity);
            console.log("Conversation saved:", savedConversationReference.conversation.id);

            const userMessage = (context.activity.text || "").toLowerCase().trim();
            const value = context.activity.value || null;

            // =========================================
            // ADAPTIVE CARD SUBMIT (buttons + typed input)
            // =========================================
            if (value && value.questionId) {
                const typedText = String(value.update || value.response || "").trim();
                const statusLabel = value.status || null;

                const answered = await handleUserResponse(
                    context,
                    value.questionId,
                    typedText,
                    statusLabel
                );

                if (!answered) {
                    await context.sendActivity("Sorry, I could not find that standup question.");
                }
                return next();
            }

            // =========================================
            // TRIGGER WORKFLOW
            // =========================================
            if (userMessage === "run standup") {
                await context.sendActivity("Starting scheduled standup...");
                await executeStandupWorkflow(context);
                return next();
            }

            // =========================================
            // PLAIN-TEXT RESPONSE FALLBACK
            // Match the sender to an open (PENDING) question
            // in an active session, then run the same pipeline.
            // =========================================
            if (userMessage) {
                const senderName = context.activity.from && context.activity.from.name;
                const senderId = context.activity.from && context.activity.from.id;
                const activeSessions = await getActiveWaitingSessions();

                for (const session of activeSessions) {
                    const open = await getOpenQuestionForMember(
                        session.id,
                        senderName || senderId || ""
                    );

                    if (open) {
                        const answered = await handleUserResponse(
                            context,
                            open.id,
                            userMessage,
                            null
                        );
                        if (answered) {
                            return next();
                        }
                        break;
                    }
                }

                if (!userMessage.startsWith("run")) {
                    await context.sendActivity("I could not find an open standup question for your user.");
                }
            }

            await next();
        });

        // =========================================
        // BOT ADDED (save conversation reference)
        // =========================================
        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;

            for (const member of membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    console.log("Bot added to Team/Chat");
                    console.log("Conversation ID:", context.activity.conversation.id);

                    savedConversationReference =
                        TurnContext.getConversationReference(context.activity);
                    console.log(
                        "Conversation reference saved (auto-start ready):",
                        savedConversationReference.conversation.id
                    );
                }
            }

            await next();
        });
    }
}

module.exports = {
    MyBot,
    getConversationReference: () => savedConversationReference
};
