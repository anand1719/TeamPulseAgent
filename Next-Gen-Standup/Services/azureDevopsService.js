const axios = require("axios");

require("dotenv").config();

const organization =
    process.env.AZURE_ORGANIZATION;

const project =
    process.env.AZURE_PROJECT;

const personalAccessToken =
    process.env.AZURE_PAT;

// ===========================================
// COMMON HEADERS
// ===========================================

const headers = {
    Authorization:
        `Basic ${Buffer.from(
            ":" + personalAccessToken
        ).toString("base64")}`
};

// ===========================================
// GET WORK ITEMS
// ===========================================


// async function getWorkItems() {

//     const response = await axios.post(

//         `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql?api-version=7.0`,

//         {
//             query: `
//                 SELECT
//                     [System.Id],
//                     [System.Title],
//                     [System.State],
//                     [System.AssignedTo],
//                     [System.ChangedDate]
//                 FROM WorkItems
//                 WHERE
//                     [System.State] <> 'Closed'
//             `
//         },

//         { headers }
//     );

//     return response.data.workItems;
// }

async function getWorkItems() {

    return [
        { id: 101 },
        { id: 102 },
    ];
}


// ===========================================
// GET WORK ITEM DETAILS
// ===========================================

// async function getWorkItemDetails(ids) {

//     try {

//         const workItemIds =
//             ids.join(",");

//         const response =
//             await axios.get(

//                 `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems`,

//                 {
//                     params: {
//                         ids: workItemIds,
//                         "api-version": "7.0"
//                     },

//                     headers
//                 }
//             );

//         return response.data.value;

//     } catch (error) {

//         console.error(
//             "Azure DevOps Error:",
//             error.response?.data || error.message
//         );

//         throw error;
//     }
// }

async function getWorkItemDetails(ids) {

    return [
        {
            id: 101,
            fields: {
                "System.Title":
                    "Payment API integration pending",

                "System.State":
                    "In Progress",

                "System.AssignedTo": {
                    displayName: "Anand",
                    managerName: "Ramesh",
                    managerEmail:"ramesh@test.com"                    
                },

                "System.ChangedDate":
                    "2026-05-01"
            }
        },
        {
            id: 102,
            fields: {
                "System.Title":
                    "Dashboard UI bug",

                "System.State":
                    "Blocked",

                "System.AssignedTo": {
                    displayName: "Rahul",
                    managerName: "Ramesh",
                    managerEmail:"ramesh@test.com"
                },

                "System.ChangedDate":
                    "2026-04-28"
            }
        }
    ];
}


module.exports = {
    getWorkItems,
    getWorkItemDetails
};