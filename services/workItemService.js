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

            // INACTIVITY + STATE-DURATION CALCULATION
            // System.ChangedDate moves on ANY field change
            // (comments, tags, iterations, ...), so it is the
            // best available "last touched" signal. The honest
            // number for "not started" / "blocked" hints is
            // Microsoft.VSTS.Common.StateChangeDate - how long
            // the item has sat in its CURRENT state. Both are
            // guarded against missing/invalid dates and clock
            // skew so the counts are always sane ints >= 0.

            const changedDateValue =
                fields["System.ChangedDate"];

            const stateChangedValue =
                fields["Microsoft.VSTS.Common.StateChangeDate"];

            const currentDate =
                new Date();

            function daysSince(value) {
                if (!value) {
                    return 0;
                }
                const parsed = new Date(value);
                if (isNaN(parsed.getTime())) {
                    return 0;
                }
                const diffTime = currentDate - parsed;
                return Math.max(
                    0,
                    Math.floor(
                        diffTime / (1000 * 60 * 60 * 24)
                    )
                );
            }

            const daysInactive = daysSince(changedDateValue);
            // Fall back to the last edit when ADO does not
            // expose a state-change date for this work item.
            const rawDaysInState = daysSince(stateChangedValue);
            const daysInState = rawDaysInState || daysInactive;

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

                state_changed:
                    fields["Microsoft.VSTS.Common.StateChangeDate"] || null,

                days_inactive:
                    daysInactive,

                days_in_state:
                    daysInState
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
        priority,
        inactive_days,
        days_in_state,
        last_updated,
        state_changed
    } = params;

    const query = `
        INSERT INTO work_items
        (
            external_ticket_id,
            team_member_id,
            source_system,
            title,
            state,
            priority,
            inactive_days,
            days_in_state,
            last_updated,
            state_changed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
    `;

    const values = [
        external_ticket_id,
        team_member_id,
        source_system,
        title,
        state,
        priority,
        Number.isFinite(Number(inactive_days)) ? Number(inactive_days) : 0,
        Number.isFinite(Number(days_in_state)) ? Number(days_in_state) : 0,
        last_updated || null,
        state_changed || null
    ];

    const result =
        await pool.query(query, values);

    return result;
}

// ===========================================
// REFRESH AN EXISTING SNAPSHOT
// saveWorkItem() only ever INSERTs, so a ticket
// that was snapshotted once kept its very first
// state forever (the PDF report, the question
// text and the next session's questions all read
// work_items.state). Called with the live Azure
// DevOps values right before a new standup, so
// the stored snapshot is never older than the
// last run.
//
// Rows are matched on the EXTERNAL ticket id so
// duplicate snapshots of the same ticket stay in
// step with each other.
// ===========================================

async function refreshWorkItemSnapshot(item) {

    const externalId =
        item && item.id !== null && item.id !== undefined
            ? String(item.id).trim()
            : '';

    if (!externalId) {
        return [];
    }

    const query = `
        UPDATE work_items
        SET title         = $1,
            state         = $2,
            inactive_days = $3,
            days_in_state = $4,
            last_updated  = $5,
            state_changed = $6
        WHERE external_ticket_id = $7
        RETURNING *
    `;

    const values = [
        item.title || null,
        item.state || null,
        Number.isFinite(Number(item.days_inactive)) ? Number(item.days_inactive) : 0,
        Number.isFinite(Number(item.days_in_state)) ? Number(item.days_in_state) : 0,
        item.last_updated || null,
        item.state_changed || null,
        externalId
    ];

    const result =
        await pool.query(query, values);

    return result.rows;
}

// ===========================================
// APPLY A CONFIRMED STATE CHANGE
// Called after a work-item state was successfully
// pushed to Azure DevOps from the web chat
// "Proposed Azure DevOps Updates" card. The board
// and the local snapshot would otherwise disagree
// (the report PDF reads work_items.state, so a
// ticket moved to Done kept printing "Doing").
//
// The item was just touched, so it has been zero
// days in its new state and zero days inactive.
// ===========================================

async function applyWorkItemState(externalTicketId, state) {

    const externalId =
        externalTicketId !== null && externalTicketId !== undefined
            ? String(externalTicketId).trim()
            : '';

    if (!externalId || !state) {
        return [];
    }

    const result = await pool.query(
        `UPDATE work_items
         SET state         = $1,
             state_changed = NOW(),
             last_updated  = NOW(),
             inactive_days = 0,
             days_in_state = 0
         WHERE external_ticket_id = $2
         RETURNING *`,
        [String(state), externalId]
    );

    return result.rows;
}

module.exports = {
    getWorkItemByMember,
    saveWorkItem,
    refreshWorkItemSnapshot,
    applyWorkItemState,
    workItemAssignedTo
};
