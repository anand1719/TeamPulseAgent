// const axios = require("axios");

// const {
//     generateDynamicQuestion
// } = require("../services/aiService");

// async function executeStandupWorkflow(context) {

//     try {

//         await context.sendActivity(
//             "Starting Next-Gen Smart Standup..."
//         );

//         // =========================================
//         // STEP 1
//         // FETCH STANDUP CONFIGURATIONS
//         // =========================================
//         try {
//             const configurationResponse =
//                 await axios.get(
//                     "http://localhost:5000/api/standup/configurations"
//                 );

//             const configurations =
//                 configurationResponse.data.data;

//             // =========================================
//             // VALIDATION
//             // =========================================

//             if (!configurations.length) {

//                 await context.sendActivity(
//                     "No standup configurations found."
//                 );

//                 return;
//             }

//             // =========================================
//             // GROUP MEMBERS BY TEAM
//             // =========================================

//             const groupedTeams = {};

//             for (const config of configurations) {

//                 const teamId =
//                     config.team_id;

//                 // Create team group if not exists

//                 if (!groupedTeams[teamId]) {

//                     groupedTeams[teamId] = {

//                         team_name:
//                             config.team_name,

//                         escalation_enabled:
//                             config.escalation_enabled,

//                         members: []
//                     };
//                 }

//                 // Push member into team

//                 groupedTeams[teamId].members.push({

//                     member_id:
//                         config.member_id,

//                     member_name:
//                         config.name,

//                     email:
//                         config.email,

//                     role:
//                         config.role,

//                     teams_user_id:
//                         config.teams_user_id
//                 });
//             }

//             // =========================================
//             // ITERATE TEAMS
//             // =========================================

//             for (const teamId in groupedTeams) {

//                 const team =
//                     groupedTeams[teamId];

//                 await context.sendActivity(
//                     `Processing Team: ${team.team_name}`
//                 );

//                 // =========================================
//                 // ITERATE MEMBERS
//                 // =========================================

//                 for (const member of team.members) {

//                     const memberId =
//                         member.member_id;

//                     const memberName =
//                         member.member_name;

//                     await context.sendActivity(
//                         `Fetching work items for ${memberName}`
//                     );
//                 }
//             }
//         }
//         catch (error) {

//             console.error(
//                 "Configuration API Error:",
//                 error.message
//             );

//             await context.sendActivity(
//                 "Failed to fetch standup configurations."
//             );

//             return;
//         }

//         // =========================================
//         // FETCH WORK ITEMS
//         // =========================================

//         const workItemResponse =
//             await axios.get(
//                 `http://localhost:5000/api/work-items/${memberName}`
//             );

//         const workItems =
//             workItemResponse.data;

//         // =========================================
//         // NO WORK ITEMS
//         // =========================================

//         if (!workItems.length) {

//             await context.sendActivity(
//                 `No work items found for ${memberName}`
//             );

//             continue;
//         }

//         // =========================================
//         // ITERATE WORK ITEMS
//         // =========================================

//         for (const item of workItems) {

//             // =========================================
//             // BUILD TICKET DETAILS
//             // =========================================

//             const ticketDetails = `
//                     Ticket ID: ${item.id}

//                     Title:
//                     ${item.title}

//                     State:
//                     ${item.state}

//                     Assigned To:
//                     ${memberName}

//                     Last Updated:
//                     ${item.last_updated}
//                     `;

//             // =========================================
//             // GENERATE AI QUESTION
//             // =========================================

//             const question =
//                 await generateDynamicQuestion(
//                     ticketDetails
//                 );

//             // =========================================
//             // SAVE QUESTION
//             // =========================================

//             await axios.post(
//                 "http://localhost:5000/api/questions",
//                 {
//                     work_item_id:
//                         item.id,

//                     member_id:
//                         memberId,

//                     question:
//                         question,

//                     asked_to:
//                         memberName
//                 }
//             );

//             // =========================================
//             // SEND QUESTION
//             // =========================================

//             await context.sendActivity(
//                 `Question for ${memberName}: \n\n${question}`
//             );

//             // // =========================================
//             // // ESCALATION CHECK
//             // // =========================================

//             // const daysInactive =
//             //     item.days_inactive || 0;

//             // if (
//             //     daysInactive > 5 &&
//             //     team.escalation_enabled
//             // ) {

//             //     await axios.post(
//             //         "http://localhost:5000/escalations",
//             //         {
//             //             team_id:
//             //                 teamId,

//             //             member_id:
//             //                 memberId,

//             //             work_item_id:
//             //                 item.id,

//             //             escalation_level:
//             //                 "HIGH",

//             //             reason:
//             //                 "Ticket inactive for more than 5 days"
//             //         }
//             //     );

//             //     await context.sendActivity(
//             //         `Escalation raised for Ticket ${item.id}`
//             //     );
//             // }
//         }
//     }
// }


// // =========================================
// // GENERATE INSIGHTS
// // =========================================

// await axios.post(
//     "http://localhost:5000/api/insights/generate"
// );

// await context.sendActivity(
//     "AI insights generated successfully."
// );

// // =========================================
// // GENERATE REPORTS
// // =========================================

// // await axios.post(
// //     "http://localhost:5000/reports/generate"
// // );

// // await context.sendActivity(
// //     "Intelligent standup report generated."
// // );

// // =========================================
// // COMPLETED
// // =========================================

// await context.sendActivity(
//     "Next-Gen Smart Standup completed successfully."
// );

//     } catch (error) {

//     console.error(
//         "Standup Workflow Error:",
//         error.message
//     );

//     await context.sendActivity(
//         "Error executing standup workflow."
//     );
// }
// }

// module.exports = {
//     executeStandupWorkflow
// };


const axios = require("axios");

const {
    generateDynamicQuestion
} = require("../services/aiService");

console.log("WORKFLOW STARTED");
async function executeStandupWorkflow(context) {

    try {

        await context.sendActivity(
            "Starting Next-Gen Smart Standup..."
        );

        // =========================================
        // STEP 1
        // FETCH STANDUP CONFIGURATIONS
        // =========================================

        let configurationResponse;

        try {

            configurationResponse =
                await axios.get(
                    "http://localhost:5000/api/standup/configurations"
                );

        } catch (error) {

            console.error(
                "Configuration API Error:",
                error.message
            );

            await context.sendActivity(
                "Failed to fetch standup configurations."
            );

            return;
        }

        const configurations =
            configurationResponse.data.data;

        // =========================================
        // VALIDATION
        // =========================================

        if (!configurations.length) {

            await context.sendActivity(
                "No standup configurations found."
            );

            return;
        }

        // =========================================
        // GROUP MEMBERS BY TEAM
        // =========================================

        const groupedTeams = {};

        for (const config of configurations) {

            const teamId =
                config.team_id;

            if (!groupedTeams[teamId]) {

                groupedTeams[teamId] = {

                    team_name:
                        config.team_name,

                    escalation_enabled:
                        config.escalation_enabled,

                    members: []
                };
            }

            groupedTeams[teamId].members.push({

                member_id:
                    config.member_id,

                member_name:
                    config.name,

                email:
                    config.email,

                role:
                    config.role,

                teams_user_id:
                    config.teams_user_id
            });
        }


        // =========================================
        // ITERATE TEAMS
        // =========================================

        for (const teamId in groupedTeams) {

            const team =
                groupedTeams[teamId];

            let sessionResponse;
            let sessionId;

            await context.sendActivity(
                `Processing Team: ${team.team_name}`
            );

            console.log("CREATING SESSION FOR TEAM:", teamId);
            // =========================================
            // STEP 3
            // GENERATE SESSION ID
            // =========================================
            try {

                sessionResponse =
                    await axios.post(
                        "http://localhost:5000/api/standup/session",
                        {
                            team_id: teamId,
                            standup_date: new Date(),
                            status: "IN_PROGRESS"
                        }
                    );

                sessionId =
                    sessionResponse.data.id;

                console.log(
                    `Standup Session Created: ${sessionId}`
                );

            } catch (error) {

                console.error(
                    `Standup Session API Error for Team ${team.team_name}:`,
                    error.response?.data || error.message
                );

                await context.sendActivity(
                    `Failed to create standup session for ${team.team_name}`
                );

                continue;
            }


            // =========================================
            // ITERATE MEMBERS
            // =========================================

            for (const member of team.members) {

                const memberId =
                    member.member_id;

                const memberName =
                    member.member_name;

                await context.sendActivity(
                    `Fetching work items for ${memberName}`
                );

                // =========================================
                // STEP 2
                // FETCH WORK ITEMS
                // =========================================

                let workItemResponse;

                try {

                    workItemResponse =
                        await axios.get(
                            `http://localhost:5000/api/work-items/${memberName}`
                        );

                } catch (error) {

                    console.error(
                        `Work Item API Error for ${memberName}:`,
                        error.message
                    );

                    await context.sendActivity(
                        `Failed to fetch work items for ${memberName}`
                    );

                    continue;
                }

                const workItems =
                    workItemResponse.data;

                // =========================================
                // NO WORK ITEMS
                // =========================================

                if (!workItems.length) {

                    await context.sendActivity(
                        `No work items found for ${memberName}`
                    );

                    continue;
                }

                // =========================================
                // ITERATE WORK ITEMS
                // =========================================

                for (const item of workItems) {

                    // =========================================
                    // BUILD TICKET DETAILS
                    // =========================================

                    const ticketDetails = `
                    Ticket ID: ${item.id}

                    Title:
                    ${item.title}

                    State:
                    ${item.state}

                    Assigned To:
                    ${memberName}

                    Last Updated:
                    ${item.last_updated}
                    `;



                    // =========================================
                    // STEP 4
                    // GENERATE AI QUESTION
                    // =========================================

                    let question;

                    try {

                        question =
                            await generateDynamicQuestion(
                                ticketDetails
                            );

                    } catch (error) {

                        console.error(
                            `AI Question Generation Error for Ticket ${item.id}:`,
                            error.message
                        );

                        await context.sendActivity(
                            `AI failed to generate question for Ticket ${item.id}`
                        );

                        continue;
                    }



                    // =========================================
                    // STEP 5
                    // SAVE QUESTION
                    // =========================================

                    try {
                        const questionPayload = {
                            standup_session_id: sessionId,

                            team_member_id:
                                memberId,

                            work_item_id:
                                item.id,

                            question:
                                question,

                            asked_to:
                                memberName
                        };

                        console.log(
                            "Question API Request:",
                            JSON.stringify(questionPayload, null, 2)
                        );
                        await axios.post(
                            "http://localhost:5000/api/questions",
                            questionPayload
                        );

                    } catch (error) {

                        console.error(
                            `Save Question API Error for Ticket ${item.id}:`,
                            error.message
                        );

                        await context.sendActivity(
                            `Failed to save question for Ticket ${item.id}`
                        );
                    }

                    // =========================================
                    // STEP 6
                    // SEND QUESTION
                    // =========================================

                    try {

                        await context.sendActivity(
                            `Question for ${memberName}: \n\n${question}`
                        );

                    } catch (error) {

                        console.error(
                            `Teams Message Send Error for ${memberName}:`,
                            error.message
                        );
                    }

                    // =========================================
                    // STEP 7
                    // ESCALATION CHECK
                    // =========================================
                    const daysInactive =
                        item.inactive_days || 0;
                    console.log("Inactive Days", daysInactive);
                    if (daysInactive > 3) {
                        try {

                            const escalationPayload = {
                                team_id:
                                    teamId,

                                member_id:
                                    memberId,

                                work_item_id:
                                    item.id,

                                escalation_level:
                                    daysInactive > 10 ? "CRITICAL" :
                                        daysInactive > 5 ? "HIGH" :
                                            "MEDIUM",
                                reason:
                                    `Ticket inactive for ${daysInactive}  days`

                            }

                            console.log("Escalation Payload", escalationPayload);
                            await axios.post(
                                "http://localhost:5000/api/escalations",
                                escalationPayload
                            );

                            await context.sendActivity(
                                `Escalation raised for Ticket ${item.id}`
                            );

                        }
                        catch (error) {

                            console.error(
                                `Escalation API Error for Ticket ${item.id}:`,
                                error.message
                            );

                            await context.sendActivity(
                                `Failed to raise escalation for Ticket ${item.id}`
                            );
                        }
                    }
                }
                // =========================================
                // STEP 8
                // GENERATE DYNAMIC INSIGHTS
                // =========================================

                try {

                    let blockers = [];
                    let risks = [];
                    let recommendations = [];
                    let completedCount = 0;
                    let blockedCount = 0;
                    let inProgressCount = 0;

                    // =========================================
                    // ANALYZE TEAM WORK ITEMS
                    // =========================================

                    for (const member of team.members) {

                        const memberName =
                            member.member_name;

                        const workItemResponse =
                            await axios.get(
                                `http://localhost:5000/api/work-items/${memberName}`
                            );

                        const workItems =
                            workItemResponse.data;

                        for (const item of workItems) {

                            // =========================================
                            // STATE ANALYSIS
                            // =========================================

                            if (
                                item.state?.toLowerCase() ===
                                "blocked"
                            ) {

                                blockedCount++;

                                blockers.push(
                                    `${item.title} is blocked`
                                );

                                recommendations.push(
                                    `Follow up with ${memberName} regarding blocker on ${item.title}`
                                );
                            }

                            else if (
                                item.state?.toLowerCase() ===
                                "in progress"
                            ) {

                                inProgressCount++;
                            }

                            else if (
                                item.state?.toLowerCase() ===
                                "completed"
                            ) {

                                completedCount++;
                            }

                            // =========================================
                            // INACTIVE TICKET RISK
                            // =========================================

                            if (
                                item.inactive_days > 3
                            ) {

                                risks.push(
                                    `${item.title} inactive for ${item.inactive_days} days`
                                );

                                recommendations.push(
                                    `Request status update for ${item.title}`
                                );
                            }

                            // =========================================
                            // ESCALATION RISK
                            // =========================================

                            if (
                                item.inactive_days > 5
                            ) {

                                risks.push(
                                    `High risk: ${item.title} may impact sprint delivery`
                                );

                                recommendations.push(
                                    `Escalate ${item.title} to manager`
                                );
                            }
                        }
                    }

                    // =========================================
                    // BUILD SUMMARY
                    // =========================================

                    const summary = `
            Team ${team.team_name} Standup Summary:

            Completed Tickets: ${completedCount}
            In Progress Tickets: ${inProgressCount}
            Blocked Tickets: ${blockedCount}
            `;

                    // =========================================
                    // SENTIMENT
                    // =========================================

                    let sentiment = "POSITIVE";

                    if (blockedCount > 0) {

                        sentiment = "NEUTRAL";
                    }

                    if (blockedCount >= 2) {

                        sentiment = "NEGATIVE";
                    }

                    // =========================================
                    // BUILD INSIGHT PAYLOAD
                    // =========================================

                    let sessionId;
                    sessionId =
                        sessionResponse.data.id;

                    const insightPayload = {

                        standup_session_id:
                            sessionId,

                        summary:
                            summary,

                        blockers:
                            blockers.join(", "),

                        risks:
                            risks.join(", "),

                        recommendations:
                            recommendations.join(", "),

                        sentiment:
                            sentiment
                    };

                    console.log(
                        "Dynamic Insight Payload:",
                        JSON.stringify(insightPayload, null, 2)
                    );

                    // =========================================
                    // SAVE INSIGHTS
                    // =========================================

                    await axios.post(
                        "http://localhost:5000/api/insights",
                        insightPayload
                    );

                    await context.sendActivity(
                        "AI insights generated successfully."
                    );

                } catch (error) {

                    console.error(
                        "Insights API Error:",
                        error.response?.data || error.message
                    );

                    await context.sendActivity(
                        "Failed to generate AI insights."
                    );
                }
            }
        }


        // =========================================
        // STEP 9
        // GENERATE REPORT
        // =========================================

        try {

            await axios.post(
                "http://localhost:5000/api/reports/generate",
                {sessionId:sessionId}
            );

            await context.sendActivity(
                "Intelligent standup report generated."
            );

        } catch (error) {

            console.error(
                "Report Generation API Error:",
                error.message
            );

            await context.sendActivity(
                "Failed to generate intelligent report."
            );
        }

        // =========================================
        // COMPLETED
        // =========================================

        await context.sendActivity(
            "Next-Gen Smart Standup completed successfully."
        );

    } catch (error) {

        console.error(
            "Standup Workflow Error:",
            error.message
        );

        await context.sendActivity(
            "Error executing standup workflow."
        );
    }
}
module.exports = {
    executeStandupWorkflow
};