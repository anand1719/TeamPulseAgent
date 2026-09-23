// =============================================
// linearService.js
// Thin wrapper around the Linear GraphQL API
// (https://api.linear.app/graphql) used by the
// standup:
//   - getLinearViewer()             : identity/auth check
//     (who the API key belongs to).
//   - getLinearWorkItems()          : flat list of the
//     *references* (id + identifier + url) of every issue
//     still actionable in the workspace.
//   - getLinearWorkItemDetails(ids) : full issue details for
//     a single id or an array of ids, batched to honour the
//     API's per-request node limit.
//   - mapLinearIssue(issue)         : normalises a raw issue
//     to the same shape workItemService builds for Azure
//     DevOps items (id/title/state/assigned_to/last_updated/
//     days_inactive) so downstream code can be source-agnostic.
//
// Auth: Linear personal API keys (lin_api_...) are sent
// *raw* in the Authorization header, while OAuth access
// tokens must be prefixed with "Bearer ". Both are
// accepted so a pasted "Bearer xxx" value still works.
// =============================================

const axios = require('axios');

require('dotenv').config();

const LINEAR_API_URL = 'https://api.linear.app/graphql';

// =============================================
// LIMITS & DEFAULTS
// =============================================

// Linear caps graph connections (e.g. issues) at 50 nodes per
// request by default, so id lookups are batched like the
// Azure DevOps 200-ids-per-call batching.
const MAX_ISSUES_PER_REQUEST = Number(process.env.LINEAR_ISSUES_PER_REQUEST) || 50;

// Cap the open-issue result set so a large workspace never
// produces an unbounded chain of detail requests.
const MAX_LINEAR_RESULTS = Number(process.env.LINEAR_MAX_RESULTS) || 200;

// Workflow-state *types* that mean "nothing left to ask about"
// (the Linear equivalent of Azure DevOps' Closed/Done/Removed).
const TERMINAL_STATE_TYPES = ['completed', 'canceled'];

// Issue fields consumed downstream (mirrors
// WORK_ITEM_DETAIL_FIELDS in azureDevopsService).
const ISSUE_FIELDS = `
    id
    identifier
    title
    url
    state {
        name
        type
    }
    assignee {
        id
        name
        displayName
        email
    }
    updatedAt
    createdAt
`;

// =============================================
// AUTH
// =============================================

function authHeaderValue() {
    const key = String(process.env.LINEAR_API_KEY || '').trim();

    if (!key) {
        throw new Error(
            'LINEAR_API_KEY is not set. Add it to .env (see .env.example).'
        );
    }

    // Already prefixed (e.g. copied from an OAuth response).
    if (/^bearer\s/i.test(key)) {
        return key;
    }

    // OAuth access tokens need the Bearer prefix, personal keys do not.
    return key.startsWith('lin_oauth_')
        ? `Bearer ${ key }`
        : key;
}

// =============================================
// LOW-LEVEL GRAPHQL CALL
// Returns response.data.data, or throws on a transport error
// *or* a GraphQL error (Linear answers HTTP 200 with an
// `errors` array for failed queries, so this must be checked
// explicitly or callers silently receive undefined).
// =============================================

async function callLinear(query, variables) {
    try {
        const response = await axios.post(
            LINEAR_API_URL,
            {
                query,
                variables: variables || {}
            },
            {
                headers: {
                    Authorization: authHeaderValue(),
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        const errors = response.data?.errors;

        if (Array.isArray(errors) && errors.length) {
            throw new Error(
                errors
                    .map(error => error.message)
                    .filter(Boolean)
                    .join('; ')
            );
        }

        return response.data?.data || {};
    } catch (error) {
        console.error(
            'Linear API Error:',
            error.response?.data || error.message
        );
        throw error;
    }
}

// =============================================
// GET VIEWER
// Who the configured API key belongs to. Useful as a
// credential smoke-test; previously this was all that
// (the broken) getLinearWorkItem() did.
// =============================================

async function getLinearViewer() {
    const data = await callLinear(`
        query Viewer {
            viewer {
                id
                name
                email
            }
        }
    `);

    return data.viewer || null;
}

// =============================================
// GET WORK ITEMS
// Flat list of the *references* (id + identifier + url) of
// all still-actionable issues in the workspace. Terminal
// states (completed, canceled) are excluded up-front, exactly
// like getWorkItems() excludes Closed/Done/Removed in
// Azure DevOps, so finished tickets are never asked about.
// =============================================

async function getLinearWorkItems() {
    // Linear's schema does not expose usable enum *type names* for
    // filter inputs, so the terminal state types are inlined as
    // quoted literals (values come from the constant above, never
    // from user input).
    const terminalTypes =
        TERMINAL_STATE_TYPES
            .map(type => `"${ type }"`)
            .join(', ');

    const data = await callLinear(
        `
            query OpenIssues($first: Int!) {
                issues(
                    first: $first
                    filter: { state: { type: { nin: [${ terminalTypes }] } } }
                    orderBy: updatedAt
                ) {
                    nodes {
                        id
                        identifier
                        url
                    }
                }
            }
        `,
        {
            first: MAX_LINEAR_RESULTS
        }
    );

    const nodes = data.issues?.nodes || [];

    return nodes
        .slice(0, MAX_LINEAR_RESULTS)
        .map(issue => ({
            id: issue.id,
            identifier: issue.identifier,
            url: issue.url
        }));
}

// =============================================
// GET WORK ITEM DETAILS
// Fetches full details for the given Linear issue ids (a
// single id or an array is accepted, and both the internal
// UUID and the human identifier such as "ENG-123" work).
// Requests are batched to stay within the API's per-call node
// limit. An empty/blank id list resolves to [] instead of
// querying with an empty `in` filter.
// =============================================

async function getLinearWorkItemDetails(ids) {
    const normalizedIds =
        Array.isArray(ids) ? ids : [ids];

    const cleanIds =
        normalizedIds
            .filter(id => id !== null && id !== undefined)
            .map(id => String(id).trim())
            .filter(id => id.length > 0);

    // Linear returns each matching issue once, but de-duplicate
    // so a repeated id does not inflate the batch size.
    const uniqueIds =
        Array.from(new Set(cleanIds));

    if (uniqueIds.length === 0) {
        return [];
    }

    const results = [];

    for (let i = 0; i < uniqueIds.length; i += MAX_ISSUES_PER_REQUEST) {
        const batch =
            uniqueIds.slice(i, i + MAX_ISSUES_PER_REQUEST);

        const data = await callLinear(
            `
                query IssueDetails($ids: [ID!], $first: Int!) {
                    issues(
                        first: $first
                        filter: { id: { in: $ids } }
                    ) {
                        nodes {
                            ${ ISSUE_FIELDS }
                        }
                    }
                }
            `,
            {
                ids: batch,
                first: batch.length
            }
        );

        results.push(...(data.issues?.nodes || []));
    }

    return results;
}

// =============================================
// MAP ISSUE
// Normalises a raw Linear issue to the same shape
// workItemService builds for Azure DevOps work items, so a
// Linear-sourced item can flow through the standup unchanged.
// =============================================

function mapLinearIssue(issue) {
    if (!issue) {
        return null;
    }

    const updatedAtValue =
        issue.updatedAt;

    const updatedAt =
        updatedAtValue
            ? new Date(updatedAtValue)
            : null;

    const currentDate =
        new Date();

    let daysInactive = 0;

    if (updatedAt && !isNaN(updatedAt.getTime())) {
        const diffTime =
            currentDate - updatedAt;

        daysInactive =
            Math.max(
                0,
                Math.floor(
                    diffTime / (1000 * 60 * 60 * 24)
                )
            );
    }

    return {

        id:
            issue.id,

        identifier:
            issue.identifier,

        title:
            issue.title,

        state:
            issue.state?.name || null,

        // Linear's `name` is the human full name (the Azure DevOps
        // System.AssignedTo.displayName equivalent), while `displayName`
        // is the workspace handle (e.g. "anand94mhatre"), so the full
        // name is preferred for display.
        assigned_to:
            issue.assignee?.name ||
            issue.assignee?.displayName ||
            null,

        assignee_email:
            issue.assignee?.email || null,

        assignee_handle:
            issue.assignee?.displayName ||
            issue.assignee?.name ||
            null,

        last_updated:
            updatedAtValue || null,

        // Linear exposes no per-state change timestamp, so the
        // honest "days in state" number falls back to the last
        // update - same fallback the ADO path uses when
        // StateChangeDate is absent.
        state_changed:
            null,

        days_inactive:
            daysInactive,

        days_in_state:
            daysInactive,

        url:
            issue.url || null
    };
}

module.exports = {
    getLinearViewer,
    getLinearWorkItems,
    getLinearWorkItemDetails,
    mapLinearIssue
};
