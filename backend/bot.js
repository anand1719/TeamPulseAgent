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

            const rawText = (context.activity.text || "").trim();
            const userMessage = rawText.toLowerCase();

            const value = context.activity.value || null;

            // =========================================
            // ADAPTIVE CARD SUBMIT (buttons + typed input)
            // =========================================
            if (value && value.questionId) {
                const typedText = String(value.update || value.response || "").trim();
                const statusLabel = value.status || null;
                // The card's "Submit Update" action is the only way to
                // answer it (it carries fromInput). A payload without the
                // flag - e.g. one of the old status buttons - must never be
                // recorded, so the explicit-submit marker is passed on.
                const explicitSubmit = value.fromInput === true;

                const answered = await handleUserResponse(
                    context,
                    value.questionId,
                    typedText,
                    statusLabel,
                    { explicitSubmit }
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
                        // A typed chat reply IS an explicit update, and
                        // the ORIGINAL text (not the lower-cased copy used
                        // for command matching) is what gets stored.
                        const answered = await handleUserResponse(
                            context,
                            open.id,
                            rawText,
                            null,
                            { explicitSubmit: true }
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
