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
// A blanket "⚠️ inactive" for every ticket that
// has not been edited in N days is misleading:
//   - "To Do" items were never started -> they are
//     "not started", not "inactive".
//   - "Done" / "Closed" items are finished and
//     should never be flagged at all.
//   - Only items in an active state that have been
//     untouched for >= threshold days are truly
//     "inactive".
// The threshold is configurable via
// INACTIVE_DAYS_THRESHOLD (default 5).
// =============================================

const INACTIVE_DAYS_THRESHOLD =
    Number(process.env.INACTIVE_DAYS_THRESHOLD) || 5;

const TERMINAL_STATES = new Set([
    'done', 'closed', 'resolved', 'removed', 'completed', 'cut'
]);

const NOT_STARTED_STATES = new Set([
    'to do', 'todo', 'new', 'approved', 'proposed', 'backlog',
    'open', 'triaged', 'design in progress'
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

function buildStateBadge(state, inactiveDays) {
    const normalizedState = normalizeState(state);
    const days = sanitizeInactiveDays(inactiveDays);

    // Finished work is never "inactive".
    if (!normalizedState || TERMINAL_STATES.has(normalizedState)) {
        return '';
    }

    // Nothing to flag while the item has been touched
    // inside the threshold window.
    if (days < INACTIVE_DAYS_THRESHOLD) {
        return '';
    }

    if (NOT_STARTED_STATES.has(normalizedState)) {
        return ` · ⏳ not started (${ days }d)`;
    }

    // Any remaining state (In Progress, Blocked, etc.)
    // that has been untouched for >= threshold days.
    return ` · ⚠️ inactive (${ days }d)`;
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
 * @param {number|string} params.inactiveDays  Days inactive
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
        question,
        timeoutMinutes
    } = params;

    const inactiveSuffix =
        buildStateBadge(state, inactiveDays);

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
            type: 'ActionSet',
            actions: [
                {
                    type: 'Action.Submit',
                    title: 'In Progress',
                    data: {
                        questionId,
                        status: 'In Progress'
                    }
                },
                {
                    type: 'Action.Submit',
                    title: 'Blocked',
                    data: {
                        questionId,
                        status: 'Blocked'
                    }
                },
                {
                    type: 'Action.Submit',
                    title: 'Done',
                    data: {
                        questionId,
                        status: 'Done'
                    }
                }
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
        sentiment
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

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body
    };
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
    buildEscalationNoticeCard
};
