const {
    ActivityHandler,
    TurnContext
} = require("botbuilder");

const {
    executeStandupWorkflow
} = require("./orchestrators/standupOrchestrator");

let savedConversationReference;

// Prevent multiple executions
let workflowExecuted = false;

class MyBot extends ActivityHandler {

    constructor() {

        super();

        // =========================================
        // HANDLE USER MESSAGES
        // =========================================

        this.onMessage(async (context, next) => {

            // =========================================
            // SAVE REAL EMULATOR CONVERSATION
            // =========================================

            savedConversationReference =
                TurnContext.getConversationReference(
                    context.activity
                );

            console.log(
                "Conversation saved:",
                savedConversationReference
                    .conversation
                    .id
            );

            const userMessage =
                context.activity.text
                    ?.toLowerCase()
                    .trim();

            console.log(
                "User Message:",
                userMessage
            );

            // =========================================
            // RUN STANDUP ONLY ONCE
            // =========================================

            if (!workflowExecuted) {

                workflowExecuted = true;

                await context.sendActivity(
                    "Starting Next-Gen Smart Standup..."
                );

                try {

                    await executeStandupWorkflow(
                        context
                    );

                } catch (error) {

                    console.error(
                        "Workflow Error:",
                        error
                    );

                    await context.sendActivity(
                        "Failed to execute standup workflow."
                    );
                }
            }
            else {

                await context.sendActivity(
                    `Received response: ${userMessage}`
                );
            }

            await next();
        });

        // =========================================
        // BOT ADDED
        // =========================================

        this.onMembersAdded(async (context, next) => {

            const membersAdded =
                context.activity.membersAdded;

            for (const member of membersAdded) {

                if (
                    member.id !==
                    context.activity.recipient.id
                ) {

                    console.log(
                        "Bot added to Team/Chat"
                    );

                    console.log(
                        "Conversation ID:",
                        context.activity
                            .conversation
                            .id
                    );
                }
            }

            await next();
        });
    }
}

module.exports = {
    MyBot,

    getConversationReference: () =>
        savedConversationReference
};
//##############################################################################################//

// const {
//     ActivityHandler,
//     TurnContext
// } = require("botbuilder");

// const {
//     executeStandupWorkflow
// } = require("./orchestrators/standupOrchestrator");


// let savedConversationReference;
// class MyBot extends ActivityHandler {

//     constructor() {

//         super();
//         // =========================================
//         // HANDLE USER MESSAGES
//         // =========================================

//         this.onMessage(async (context, next) => {

//             // =========================================
//             // SAVE REAL EMULATOR CONVERSATION
//             // =========================================

//             savedConversationReference =
//                 TurnContext.getConversationReference(
//                     context.activity
//                 );

//             console.log(
//                 "Conversation saved:",
//                 savedConversationReference
//                     .conversation
//                     .id
//             );

//             const userMessage =
//                 context.activity.text
//                     .toLowerCase()
//                     .trim();

//             console.log(
//                 "User Message:",
//                 userMessage
//             );

//             // =========================================
//             // TRIGGER WORKFLOW
//             // =========================================

//             if (
//                 userMessage === "run standup"
//             ) {

//                 await context.sendActivity(
//                     "Starting scheduled standup..."
//                 );

//                 await executeStandupWorkflow(
//                     context
//                 );
//             }

//             else {

//                 await context.sendActivity(
//                     `Received response: ${userMessage}`
//                 );
//             }

//             await next();
//         });

//         // =========================================
//         // BOT ADDED
//         // =========================================

//         this.onMembersAdded(async (context, next) => {

//             const membersAdded =
//                 context.activity.membersAdded;

//             for (const member of membersAdded) {

//                 if (
//                     member.id !==
//                     context.activity.recipient.id
//                 ) {

//                     console.log(
//                         "Bot added to Team/Chat"
//                     );

//                     console.log(
//                         "Conversation ID:",
//                         context.activity
//                             .conversation
//                             .id
//                     );
//                 }
//             }

//             await next();
//         });
//     }
// }

// module.exports = {
//     MyBot,

//     getConversationReference: () =>
//         savedConversationReference
// };


//##############################################################################################//


// class MyBot extends ActivityHandler
// {
//     constructor()
//     {
//         super();
//         // ========================================= // BOT ADDED TO TEAM / CHAT // ========================================= this.onMembersAdded(async (context, next) => { const membersAdded = context.activity.membersAdded; for (const member of membersAdded) { // Ignore bot itself if ( member.id !== context.activity.recipient.id ) { // ========================================= // START STANDUP WORKFLOW // ========================================= await executeStandupWorkflow( context ); } } await next(); }); // ========================================= // HANDLE USER MESSAGES // =========================================
//         this.onMessage(async (context, next) =>
//         {
//             const userMessage = context.activity.text;
//             await context.sendActivity(`Received response: ${userMessage}`);
//             await next();
//         });
//     }
// }
// module.exports.MyBot = MyBot;