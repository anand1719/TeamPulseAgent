const pool = require("../db/postgres");

const {
    getWorkItems,
    getWorkItemDetails
} = require("./azureDevopsService");

// ===========================================
// GET WORK ITEMS BY MEMBER
// ===========================================

async function getWorkItemByMember(memberName) {

    // STEP 1
    // FETCH WORK ITEM IDS

    const workItems =
        await getWorkItems();

    const ids =
        workItems.map(w => w.id);

    // STEP 2
    // FETCH DETAILED WORK ITEMS

    const detailedWorkItems =
        await getWorkItemDetails(ids);

    // STEP 3
    // FILTER MEMBER WORK ITEMS

    const filteredItems =
        detailedWorkItems.filter(item => {

            const assignedTo =
                item.fields["System.AssignedTo"]
                ?.displayName;

            return assignedTo === memberName;
        });

    // STEP 4
    // MAP RESPONSE

    const mappedItems =
        filteredItems.map(item => {

            const fields = item.fields;

            // INACTIVITY CALCULATION

            const changedDate =
                new Date(fields["System.ChangedDate"]);

            const currentDate =
                new Date();

            const diffTime =
                currentDate - changedDate;

            const daysInactive =
                Math.floor(
                    diffTime / (1000 * 60 * 60 * 24)
                );

            return {

                id: item.id,

                title:
                    fields["System.Title"],

                state:
                    fields["System.State"],

                assigned_to:
                    fields["System.AssignedTo"]
                    ?.displayName,

                last_updated:
                    fields["System.ChangedDate"],

                days_inactive:
                    daysInactive
            };
        });

    return mappedItems;
}

// ===========================================
// SAVE WORK ITEM SNAPSHOT
// OPTIONAL PERSISTENCE
// ===========================================

async function saveWorkItem(params) {

    const {
        external_ticket_id,
        team_member_id,
        source_system,
        title,
        state,
        priority
    } = params;

    const query = `
        INSERT INTO work_items
        (
            external_ticket_id,
            team_member_id,
            source_system,
            title,
            state,
            priority
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
    `;

    const values = [
        external_ticket_id,
        team_member_id,
        source_system,
        title,
        state,
        priority
    ];

    const result =
        await pool.query(query, values);

    return result;
}

module.exports = {
    getWorkItemByMember,
    saveWorkItem
};