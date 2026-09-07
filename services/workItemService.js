const pool = require("../db/postgres");

const {
    getWorkItems,
    getWorkItemDetails
} = require("./azureDevopsService");

// ===========================================
// GET WORK ITEMS BY MEMBER
// ===========================================

// Normalise a name for comparison (trim + lowercase).
function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
}

// Break a name into searchable tokens (letters, digits, . _ -).
function nameTokens(value) {
    return normalizeName(value)
        .split(/[^a-z0-9._-]+/)
        .filter(Boolean);
}

// Azure DevOps returns the full display name (e.g. "Anand Vasudev Mhatre")
// while team_members.name holds the friendly/short name (e.g. "Anand"),
// so a strict equality check silently drops every item. Instead we accept:
//   - an exact (case-insensitive) match on displayName or uniqueName,
//   - the member's name as a whole word inside the display name
//     (first-name / last-name match), and
//   - the member being a fuller name that contains the ADO display name.
function workItemAssignedTo(memberName, assignee) {
    if (!assignee) {
        return false;
    }

    const member = normalizeName(memberName);
    if (!member) {
        return false;
    }

    const display = normalizeName(assignee.displayName);
    const unique = normalizeName(assignee.uniqueName);

    for (const candidate of [display, unique]) {
        if (!candidate) {
            continue;
        }

        if (candidate === member) {
            return true;
        }

        // "anand vasudev mhatre" contains the whole word "anand".
        if (nameTokens(candidate).includes(member)) {
            return true;
        }

        // Member is a fuller name that contains the ADO display name.
        if (member.includes(candidate) && candidate.length >= 3) {
            return true;
        }
    }

    return false;
}

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

            const assignee =
                item.fields["System.AssignedTo"];

            return workItemAssignedTo(memberName, assignee);
        });

    // STEP 4
    // MAP RESPONSE

    const mappedItems =
        filteredItems.map(item => {

            const fields = item.fields;

            // INACTIVITY CALCULATION
            // System.ChangedDate moves on ANY field change
            // (comments, tags, iterations, ...), so it is the
            // best available "last touched" signal. Guard
            // against missing/invalid dates and clock skew so
            // days_inactive is always a sane non-negative int.

            const changedDateValue =
                fields["System.ChangedDate"];

            const changedDate =
                changedDateValue
                    ? new Date(changedDateValue)
                    : null;

            const currentDate =
                new Date();

            let daysInactive = 0;

            if (changedDate && !isNaN(changedDate.getTime())) {

                const diffTime =
                    currentDate - changedDate;

                daysInactive =
                    Math.max(
                        0,
                        Math.floor(
                            diffTime / (1000 * 60 * 60 * 24)
                        )
                    );
            }

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

    // STEP 4.5
    // RESOLVE INTERNAL DB ID
    // Azure DevOps work-item ids (e.g. 101) are *external* ticket ids and
    // do NOT match the auto-increment primary keys in the work_items table.

    const externalIds =
        mappedItems.map(item => String(item.id));

    let dbWorkItems = { rows: [] };

    if (externalIds.length) {

        dbWorkItems =
            await pool.query(
                `SELECT id, external_ticket_id
                 FROM work_items
                 WHERE external_ticket_id = ANY($1)`,
                [externalIds]
            );
    }

    const dbIdByExternal = new Map(
        dbWorkItems.rows.map(row => [
            String(row.external_ticket_id),
            row.id
        ])
    );

    const enrichedItems =
        mappedItems.map(item => ({
            ...item,
            db_id:
                dbIdByExternal.get(String(item.id)) || null
        }));

    return enrichedItems;
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
    saveWorkItem,
    workItemAssignedTo
};
