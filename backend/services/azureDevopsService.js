// =============================================
// azureDevopsService.js
// Thin wrapper around the Azure DevOps REST API
// used by the standup:
//   - getWorkItems()        : flat WIQL query returning
//     the references (id + url) of every work item still
//     actionable in the configured project.
//   - getWorkItemDetails(ids) : full details for a single
//     id or an array of ids, batched to honour the API's
//     200-id-per-request limit and restricted to only the
//     fields the standup actually consumes.
// =============================================

const axios = require('axios');

require('dotenv').config();

const organization =
    process.env.AZURE_ORGANIZATION;

const project =
    process.env.AZURE_PROJECT;

const personalAccessToken =
    process.env.AZURE_PAT;

// =============================================
// COMMON HEADERS
// =============================================

const headers = {
    Authorization:
        `Basic ${ Buffer.from(
            ':' + personalAccessToken
        ).toString('base64') }`
};

// =============================================
// LIMITS & DEFAULTS
// =============================================

// Azure DevOps caps GET /_apis/wit/workitems at 200 ids
// per request, so detail fetches are batched.
const MAX_WORKITEMS_PER_REQUEST = Number(process.env.AZURE_WORKITEMS_PER_REQUEST) || 200;

// Cap the flat WIQL result set so a large board never
// produces an unbounded chain of detail requests.
const MAX_WIQL_RESULTS = Number(process.env.AZURE_WIQL_MAX_RESULTS) || 200;

// Fields consumed downstream (see workItemService):
// title/state for the adaptive card, the display-name
// assignee for member filtering, the last-changed
// timestamp used to derive the activity badge, and the
// state-change timestamp, which tells how long an item
// has been sitting in its CURRENT state (the honest
// number for "not started" / "blocked" hints).
const WORK_ITEM_DETAIL_FIELDS = [
    'System.Id',
    'System.Title',
    'System.State',
    'System.AssignedTo',
    'System.ChangedDate',
    'Microsoft.VSTS.Common.StateChangeDate'
];

// =============================================
// GET WORK ITEMS
// Flat WIQL query returning the *references* (id + url)
// of all still-actionable work items in the configured
// project. Terminal states (Closed, Done, Removed) are
// excluded up-front so finished/removed tickets are
// never asked about during a standup.
// =============================================

async function getWorkItems() {
    try {
        const response = await axios.post(
            `https://dev.azure.com/${ organization }/${ project }/_apis/wit/wiql`,
            {
                query: `
                    SELECT [System.Id] FROM WorkItems
                    WHERE [System.State] NOT IN ('Closed', 'Done', 'Removed')
                `
            },
            {
                params: {
                    'api-version': '7.0',
                    $top: MAX_WIQL_RESULTS
                },
                headers
            }
        );

        return response.data.workItems || [];
    } catch (error) {
        console.error(
            'Azure DevOps Error:',
            error.response?.data || error.message
        );
        throw error;
    }
}

// =============================================
// GET WORK ITEM DETAILS
// Fetches full details for the given Azure DevOps
// work-item ids (a single id or an array is accepted).
// Requests are batched to stay within the API's per-call
// id limit, and each response is restricted to the fields
// defined in WORK_ITEM_DETAIL_FIELDS. An empty/blank id
// list resolves to [] instead of hitting the API with an
// invalid empty ids parameter (which returns HTTP 400).
// =============================================

async function getWorkItemDetails(ids) {
    const normalizedIds =
        Array.isArray(ids) ? ids : [ids];

    const cleanIds =
        normalizedIds
            .filter(id => id !== null && id !== undefined)
            .map(id => String(id).trim())
            .filter(id => id.length > 0);

    if (cleanIds.length === 0) {
        return [];
    }

    const results = [];

    try {
        for (let i = 0; i < cleanIds.length; i += MAX_WORKITEMS_PER_REQUEST) {
            const batch =
                cleanIds.slice(i, i + MAX_WORKITEMS_PER_REQUEST);

            const response =
                await axios.get(
                    `https://dev.azure.com/${ organization }/${ project }/_apis/wit/workitems`,
                    {
                        params: {
                            ids: batch.join(','),
                            fields: WORK_ITEM_DETAIL_FIELDS.join(','),
                            'api-version': '7.0'
                        },
                        headers
                    }
                );

            results.push(...(response.data.value || []));
        }

        return results;
    } catch (error) {
        console.error(
            'Azure DevOps Error:',
            error.response?.data || error.message
        );
        throw error;
    }
}

// =============================================
// GET WORK ITEM DETAILS - RESILIENT
// Same as getWorkItemDetails(), but one unusable id
// no longer costs the whole result set. Azure DevOps
// rejects an entire batch with 404 when a single id is
// unknown or not readable (e.g. a ticket from another
// project that was snapshotted earlier), which would
// otherwise silently disable every caller that needs
// live states - the PDF report above all. On a batch
// failure each id is retried on its own and the ones
// that do exist are returned.
// =============================================

async function getWorkItemDetailsResilient(ids) {

    const normalizedIds =
        Array.isArray(ids) ? ids : [ids];

    const cleanIds =
        normalizedIds
            .filter(id => id !== null && id !== undefined)
            .map(id => String(id).trim())
            .filter(id => id.length > 0);

    if (cleanIds.length === 0) {
        return [];
    }

    try {
        return await getWorkItemDetails(cleanIds);
    } catch (error) {

        // Single id: nothing to salvage.
        if (cleanIds.length === 1) {
            console.error(
                'Azure DevOps: work item ' + cleanIds[0] +
                ' could not be fetched:', error.message
            );
            return [];
        }

        console.warn(
            'Azure DevOps: batch of ' + cleanIds.length +
            ' work item(s) failed (' + error.message +
            ') - retrying individually.'
        );

        const results = [];

        for (const id of cleanIds) {
            try {
                results.push(...await getWorkItemDetails([id]));
            } catch (singleError) {
                console.error(
                    'Azure DevOps: skipping unreadable work item ' +
                    id + ':', singleError.message
                );
            }
        }

        return results;
    }
}

// =============================================
// ADD A COMMENT TO A WORK ITEM
// Used by the evening-standup "Proposed Azure DevOps
// Updates" flow: the member's answer is posted as a
// follow-up comment on the ticket (after explicit
// confirmation in the web chat).
// =============================================

async function addWorkItemComment(externalId, text) {
    const response = await axios.post(
        `https://dev.azure.com/${ organization }/${ project }/_apis/wit/workitems/${ externalId }/comments`,
        { text: String(text || '') },
        {
            params: {
                'api-version': '7.0-preview.3'
            },
            headers
        }
    );

    return response.data;
}

// =============================================
// UPDATE THE STATE OF A WORK ITEM
// JSON-Patch update of System.State (e.g. moving a
// ticket to Done when the member reports completion).
// =============================================

async function updateWorkItemState(externalId, state) {
    const response = await axios.patch(
        `https://dev.azure.com/${ organization }/${ project }/_apis/wit/workitems/${ externalId }`,
        [
            {
                op: 'add',
                path: '/fields/System.State',
                value: String(state)
            }
        ],
        {
            params: {
                'api-version': '7.0'
            },
            headers: {
                ...headers,
                'Content-Type': 'application/json-patch+json'
            }
        }
    );

    return response.data;
}

// =============================================
// CURRENT STATE OF MANY WORK ITEMS
// Returns a Map of ticket id -> System.State, used
// wherever the LOCAL snapshot may have gone stale
// (the report PDF, the sync script). Delegates the
// fetch to getWorkItemDetailsResilient(), so one
// unreadable ticket cannot knock out the states of
// all the others.
// =============================================

async function getWorkItemStates(ids) {

    const items =
        await getWorkItemDetailsResilient(ids);

    const stateById = new Map();

    for (const item of items) {
        const state =
            item && item.fields ? item.fields['System.State'] : null;

        if (state) {
            stateById.set(String(item.id), state);
        }
    }

    return stateById;
}

// =============================================
// EXPORTS
// =============================================

module.exports = {
    getWorkItems,
    getWorkItemDetails,
    getWorkItemDetailsResilient,
    getWorkItemStates,
    addWorkItemComment,
    updateWorkItemState
};
