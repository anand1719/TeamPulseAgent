// =============================================
// adaptiveCardService.js
// Builds the Adaptive Cards used by the standup:
//   - buildQuestionCard   : the per-question card with
//     greeting, work-item context, input, status
//     buttons, deadline + consequence footer.
//   - buildSummaryCard    : end-of-standup insights card.
//   - buildEscalationNoticeCard : notifies when a
//     member is escalated / marked no-response.
// All cards are returned as plain JSON attachment
// content (no external package required) and attach
// with contentType "application/vnd.microsoft.card.adaptive".
// =============================================

// =============================================
// STATE-AWARE ACTIVITY BADGE
// The badge describes the WORK ITEM STATE and must
// never contradict it:
//   - "Doing" / "In Progress" items are ACTIVE by
//     definition. Azure DevOps' System.ChangedDate
//     only moves when a field is edited - writing
//     code, commits and PRs never touch it - so a
//     genuinely active ticket could still report
//     "16 days" and was wrongly labelled "⚠️
//     inactive". Active items are therefore never
//     flagged anymore.
//   - "To Do" / "New" items were never started ->
//     "⏳ not started".
//   - "Blocked" / "On Hold" items are stalled ->
//     "⛔ blocked", reported with the time spent in
//     that state.
//   - "Done" / "Closed" items are finished and are
//     never flagged at all.
//   - Unknown states are never guessed at.
// The threshold is configurable via
// INACTIVE_DAYS_THRESHOLD (default 5).
// =============================================

const INACTIVE_DAYS_THRESHOLD =
    Number(process.env.INACTIVE_DAYS_THRESHOLD) || 5;

const TERMINAL_STATES = new Set([
    'done', 'closed', 'resolved', 'removed', 'completed', 'cut',
    'cancelled', 'canceled', 'rejected'
]);

const NOT_STARTED_STATES = new Set([
    'to do', 'todo', 'new', 'approved', 'proposed', 'backlog',
    'open', 'triaged', 'design in progress'
]);

// Work in progress: the item IS active, no badge.
const ACTIVE_STATES = new Set([
    'doing', 'in progress', 'inprogress', 'active', 'started',
    'committed', 'in development', 'development', 'implementing',
    'in review', 'review', 'code review', 'in testing', 'testing',
    'qa', 'ready for testing', 'ready for review'
]);

// Stalled although the workflow expects progress.
const BLOCKED_STATES = new Set([
    'blocked', 'on hold', 'hold', 'waiting', 'waiting for approval',
    'impeded', 'paused', 'stalled', 'stuck'
]);

function normalizeState(state) {
    return String(state || '').trim().toLowerCase();
}

function sanitizeInactiveDays(inactiveDays) {
    const days = Number(inactiveDays);
    // Guard against missing fields (NaN) and clock skew
    // (a future ChangedDate yields a negative count).
    return Number.isFinite(days) && days > 0
        ? Math.floor(days)
        : 0;
}

/**
 * Build the state suffix shown next to "State: <state>".
 *
 * @param {string} state          Work item state (e.g. "Doing")
 * @param {number|string} inactiveDays  Days since the last field edit
 * @param {number|string} [daysInState] Days spent in the current state
 *        (Microsoft.VSTS.Common.StateChangeDate); falls back to
 *        inactiveDays when the source cannot provide it.
 */
function buildStateBadge(state, inactiveDays, daysInState) {
    const normalizedState = normalizeState(state);

    // Finished or unknown work is never flagged.
    if (!normalizedState || TERMINAL_STATES.has(normalizedState)) {
        return '';
    }

    // Active work is active - whatever the last edit date says.
    // (System.ChangedDate does not move for commits / PRs / code,
    // so flagging these items as "inactive" was a false alarm.)
    if (ACTIVE_STATES.has(normalizedState)) {
        return '';
    }

    // Time spent in the current state is the honest number for
    // "not started" / "blocked"; fall back to the last edit when
    // the source does not expose a state-change date.
    const days = sanitizeInactiveDays(daysInState) ||
        sanitizeInactiveDays(inactiveDays);

    // Nothing to flag while the item has been in this state
    // for less than the threshold window.
    if (days < INACTIVE_DAYS_THRESHOLD) {
        return '';
    }

    if (NOT_STARTED_STATES.has(normalizedState)) {
        return ` · ⏳ not started (${ days }d)`;
    }

    if (BLOCKED_STATES.has(normalizedState)) {
        return ` · ⛔ blocked (${ days }d)`;
    }

    // Any other state: no claim about activity.
    return '';
}

/**
 * Build the per-question Adaptive Card.
 *
 * @param {object} params
 * @param {string} params.memberName   Display name (e.g. "Rahul")
 * @param {number|string} params.questionId  DB id of standup_questions row
 * @param {string} params.ticketLabel  e.g. "ADO-102" or "Ticket 102"
 * @param {string} params.title        Work item title
 * @param {string} params.state        Work item state
 * @param {number|string} params.inactiveDays  Days since last field edit
 * @param {number|string} params.daysInState  Days spent in the current state
 * @param {string} params.question     The AI-generated question text
 * @param {number} params.timeoutMinutes  Response deadline shown in card
 */
function buildQuestionCard(params) {
    const {
        memberName,
        questionId,
        ticketLabel,
        title,
        state,
        inactiveDays = 0,
        daysInState = 0,
        question,
        timeoutMinutes
    } = params;

    const inactiveSuffix =
        buildStateBadge(state, inactiveDays, daysInState);

    const body = [
        {
            type: 'TextBlock',
            text: `👋 ${ memberName } — Daily Standup`,
            weight: 'Bolder',
            size: 'Medium'
        },
        {
            type: 'TextBlock',
            text: `${ ticketLabel } — ${ title }`,
            weight: 'Bolder',
            wrap: true
        },
        {
            type: 'TextBlock',
            text: `State: ${ state }${ inactiveSuffix }`,
            isSubtle: true,
            wrap: true
        },
        {
            type: 'TextBlock',
            text: question,
            wrap: true
        },
        {
            type: 'Input.Text',
            id: 'update',
            placeholder: 'Type your update...',
            isMultiline: true
        },
        {
            type: 'TextBlock',
            text: 'Status:',
            weight: 'Bolder'
        },
        {
            // SELECTION ONLY - picking a status does NOT submit
            // the card. A response is recorded exclusively by the
            // "Submit Update" action below, so a status click can
            // never save an update (let alone an ANSWERED
            // question) on its own.
            type: 'Input.ChoiceSet',
            id: 'status',
            style: 'expanded',
            isMultiSelect: false,
            choices: [
                { title: 'In Progress', value: 'In Progress' },
                { title: 'Blocked', value: 'Blocked' },
                { title: 'Done', value: 'Done' }
            ]
        },
        {
            type: 'TextBlock',
            text: `⏰ Please respond within ${ timeoutMinutes } minutes`,
            isSubtle: true,
            size: 'Small'
        },
        {
            type: 'TextBlock',
            text:
                '⚠️ If no response is received by the deadline, ' +
                'you will be marked as **No Response** and your ' +
                'pending item may be escalated.',
            isSubtle: true,
            size: 'Small',
            wrap: true
        }
    ];

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body,
        actions: [
            {
                // The ONLY way to record an answer. The channel merges
                // every input of the card into this payload:
                //   { questionId, fromInput: true, update: '...', status: '...' }
                // `fromInput` is what tells the bot the member really
                // submitted the card; a bare status payload (old cards)
                // is rejected instead of being saved as an answer.
                type: 'Action.Submit',
                title: 'Submit Update',
                data: {
                    questionId,
                    fromInput: true
                }
            }
        ]
    };
}

/**
 * Build the end-of-standup insights summary card.
 */
function buildSummaryCard(params) {
    const {
        teamName,
        sessionId,
        summary,
        blockers,
        risks,
        recommendations,
        sentiment,
        reportUrl
    } = params;

    const body = [
        {
            type: 'TextBlock',
            text: `📋 Standup Summary — ${ teamName }`,
            weight: 'Bolder',
            size: 'Medium'
        },
        {
            type: 'TextBlock',
            text: `Session #${ sessionId }`,
            isSubtle: true,
            size: 'Small'
        },
        {
            type: 'TextBlock',
            text: summary || 'Standup completed.',
            wrap: true
        }
    ];

    if (blockers && blockers.length) {
        body.push({
            type: 'TextBlock',
            text: '**Blockers:**',
            weight: 'Bolder'
        });
        body.push({
            type: 'TextBlock',
            text: blockers.join('\n'),
            wrap: true
        });
    }

    if (risks && risks.length) {
        body.push({
            type: 'TextBlock',
            text: '**Risks:**',
            weight: 'Bolder'
        });
        body.push({
            type: 'TextBlock',
            text: risks.join('\n'),
            wrap: true
        });
    }

    if (recommendations && recommendations.length) {
        body.push({
            type: 'TextBlock',
            text: '**Recommendations:**',
            weight: 'Bolder'
        });
        body.push({
            type: 'TextBlock',
            text: recommendations.join('\n'),
            wrap: true
        });
    }

    if (sentiment) {
        body.push({
            type: 'TextBlock',
            text: `Sentiment: ${ sentiment }`,
            isSubtle: true,
            size: 'Small'
        });
    }

    // Download hint sits with the report action, so it is
    // only shown when a report URL is available.
    if (reportUrl) {
        body.push({
            type: 'TextBlock',
            text:
                '📄 Download the full report as a PDF — session ' +
                'overview, AI insights, flags, participation and ' +
                'per-ticket responses.',
            isSubtle: true,
            size: 'Small',
            wrap: true
        });
    }

    const card = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body
    };

    if (reportUrl) {
        // Action.OpenUrl cannot suggest a download name, but the
        // report endpoint sends Content-Disposition, so the browser
        // saves the file as "standup-summary-<team>-<date>.pdf".
        card.actions = [
            {
                type: 'Action.OpenUrl',
                title: 'Download PDF Report',
                url: reportUrl
            }
        ];
    }

    return card;
}

/**
 * Build a small notice card (escalation / no-response).
 */
function buildEscalationNoticeCard(params) {
    const {
        memberName,
        severity,
        reason
    } = params;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: `⚠️ Escalation — ${ memberName }`,
                weight: 'Bolder',
                size: 'Medium'
            },
            {
                type: 'TextBlock',
                text: `Severity: ${ severity || 'MEDIUM' }`,
                weight: 'Bolder',
                wrap: true
            },
            {
                type: 'TextBlock',
                text: reason || 'No response received before the standup deadline.',
                wrap: true
            }
        ]
    };
}

module.exports = {
    buildQuestionCard,
    buildSummaryCard,
    buildEscalationNoticeCard,
    buildStateBadge
};
