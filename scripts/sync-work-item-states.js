// =============================================
// scripts/sync-work-item-states.js
// Repairs work_items.state, which is only ever
// written the FIRST time a ticket is seen (and is
// what the downloadable PDF report prints in its
// "State" column).
//
//   node scripts/sync-work-item-states.js
//     -> uses the statuses that were already
//        confirmed + pushed to Azure DevOps from
//        the web chat card (ado_updates.applied_status)
//
//   node scripts/sync-work-item-states.js --from-ado
//     -> re-reads every ticket from Azure DevOps and
//        refreshes title/state/timestamps too
//        (use this when the board was updated by hand)
//
// Safe to re-run: it only touches rows whose stored
// values differ from the source.
// =============================================

require("dotenv").config();

const pool = require("../db/postgres");
const { refreshWorkItemSnapshot } = require("../services/workItemService");
const {
    getWorkItemDetailsResilient,
    getWorkItemStates
} = require("../services/azureDevopsService");

// Same day-count maths used by workItemService.getWorkItemByMember.
function daysSince(value) {
    if (!value) {
        return 0;
    }
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
        return 0;
    }
    return Math.max(0, Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24)));
}

function mapAdoItem(item) {
    const fields = item.fields || {};
    const daysInactive = daysSince(fields["System.ChangedDate"]);
    const stateChanged = fields["Microsoft.VSTS.Common.StateChangeDate"] || null;
    const rawDaysInState = daysSince(stateChanged);

    return {
        id: item.id,
        title: fields["System.Title"],
        state: fields["System.State"],
        days_inactive: daysInactive,
        days_in_state: rawDaysInState || daysInactive,
        last_updated: fields["System.ChangedDate"] || null,
        state_changed: stateChanged
    };
}

// ---------------------------------------------------------------
// MODE 1: replay confirmed Azure DevOps updates onto the snapshot
// ---------------------------------------------------------------

async function syncFromAdoUpdates() {
    const applied = await pool.query(
        `SELECT DISTINCT ON (external_ticket_id)
                external_ticket_id, applied_status, applied_at
           FROM ado_updates
          WHERE applied_status IS NOT NULL
          ORDER BY external_ticket_id, applied_at DESC NULLS LAST`
    );

    if (!applied.rows.length) {
        console.log("No confirmed Azure DevOps updates found.");
        return 0;
    }

    let changed = 0;

    for (const row of applied.rows) {
        const updated = await pool.query(
            `UPDATE work_items
                SET state         = $1,
                    state_changed = COALESCE($2, state_changed),
                    last_updated  = COALESCE($2, last_updated),
                    inactive_days = 0,
                    days_in_state = 0
              WHERE external_ticket_id = $3
                AND state IS DISTINCT FROM $1
              RETURNING id`,
            [row.applied_status, row.applied_at, String(row.external_ticket_id)]
        );

        if (updated.rowCount) {
            changed += updated.rowCount;
            console.log(
                "Ticket " + row.external_ticket_id +
                " -> " + row.applied_status +
                " (" + updated.rowCount + " snapshot row(s) updated)"
            );
        }
    }

    return changed;
}

// ---------------------------------------------------------------
// MODE 2: refresh every snapshot from the live Azure DevOps board
// ---------------------------------------------------------------

async function syncFromAdo() {
    const rows = await pool.query(
        `SELECT DISTINCT external_ticket_id
           FROM work_items
          WHERE external_ticket_id ~ '^[0-9]+$'
          ORDER BY external_ticket_id`
    );

    const ids = rows.rows.map(r => r.external_ticket_id);

    if (!ids.length) {
        console.log("No numeric work-item ids to sync.");
        return 0;
    }

    let changed = 0;

    // Full details, so title / timestamps / day counters are repaired as
    // well. The resilient variant retries ids one by one: a single
    // unreadable ticket (deleted on the board, or a snapshot created
    // from seed data) would otherwise fail the whole batch.
    const details = await getWorkItemDetailsResilient(ids);

    if (details.length) {
        for (const detail of details) {
            const item = mapAdoItem(detail);
            const updated = await refreshWorkItemSnapshot(item);

            if (updated.length) {
                changed += updated.length;
                console.log(
                    "Ticket " + item.id + " -> " + item.state +
                    " (" + updated.length + " snapshot row(s) synced)"
                );
            }
        }

        return changed;
    }

    // Nothing came back at all (e.g. Azure DevOps unreachable), so fall
    // back to the state-only lookup - states are what the report prints.
    console.log(
        "No full details available - falling back to state-only sync."
    );

    const states = await getWorkItemStates(ids);

    for (const [ticketId, state] of states) {
        const updated = await pool.query(
            `UPDATE work_items
                SET state = $1
              WHERE external_ticket_id = $2
                AND state IS DISTINCT FROM $1
              RETURNING id`,
            [state, ticketId]
        );

        if (updated.rowCount) {
            changed += updated.rowCount;
            console.log(
                "Ticket " + ticketId + " -> " + state +
                " (" + updated.rowCount + " snapshot row(s) synced)"
            );
        }
    }

    return changed;
}

async function main() {
    const fromAdo = process.argv.includes("--from-ado");

    console.log(
        "Syncing work-item states from " +
        (fromAdo ? "Azure DevOps" : "confirmed ado_updates") + "..."
    );

    const changed = fromAdo
        ? await syncFromAdo()
        : await syncFromAdoUpdates();

    console.log("Done. " + changed + " snapshot row(s) updated.");
    await pool.end();
}

main().catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
});
