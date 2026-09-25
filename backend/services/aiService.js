const axios = require('axios');

// Groq (OpenAI-compatible) — get a free API key at https://console.groq.com
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

async function generateDynamicQuestion(ticketDetails) {
    const prompt = `
    You are a Smart Standup AI Agent.
    Analyze the following Azure DevOps ticket details
    and generate one intelligent standup question.
    ${ ticketDetails }
    `;

    const response = await axios.post(
        GROQ_API_URL,
        {
            model: GROQ_MODEL,
            messages: [
                { role: 'system', content: 'You are a Smart Standup AI Agent.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 200
        },
        {
            headers: {
                Authorization: `Bearer ${ GROQ_API_KEY }`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data.choices[0].message.content.trim();
}

// =============================================
// LOW-LEVEL GROQ CALL (fallback-safe)
// Returns the trimmed text, or null when the API
// key is missing or the request fails (so the
// deterministic fallbacks can take over).
// =============================================
async function callGroq(prompt, system) {
    if (!GROQ_API_KEY) {
        return null;
    }

    try {
        const response = await axios.post(
            GROQ_API_URL,
            {
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: system || 'You are a Smart Standup AI Agent.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 300
            },
            {
                headers: {
                    Authorization: `Bearer ${ GROQ_API_KEY }`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        const text = response.data.choices[0].message.content.trim();
        return text || null;
    } catch (error) {
        console.error('Groq call failed:', error.message);
        return null;
    }
}

// =============================================
// ANALYZE A USER RESPONSE
// AI-first with a deterministic keyword fallback
// so the bot still works without a Groq API key
// (e.g. Emulator tests).
//
// Returns: { sentiment, blocker_detected, risk_detected, risk_reason }
// =============================================
const BLOCKER_KEYWORDS = [
    'blocked', 'blocker', 'stuck', 'cannot proceed', "can't proceed",
    'waiting on', 'waiting for', 'blocking me', 'help needed',
    'dependency', 'impediment', 'unable to', 'no progress',
    'delayed', 'risk', 'roadblock'
];

const RISK_KEYWORDS = [
    'risk', 'might miss', 'may slip', 'deadline', 'at risk',
    'delayed', 'late', 'overdue', 'not on track', 'falling behind'
];

const NEGATIVE_SENTIMENTS = [
    'negative', 'concerned', 'worried', 'urgent', 'bad', 'frustrated'
];

async function analyzeResponse(userResponse, contextText) {
    const text = `${ userResponse || '' }\n${ contextText || '' }`.toLowerCase();

    // AI-first: only when the API key exists.
    const aiResult = await callGroq(
        `Analyze this standup update for sentiment (POSITIVE/NEGATIVE/NEUTRAL), blocker (true/false) and risk (true/false) + one-line reason.\n\nResponse:\n${ userResponse }\n\nContext:\n${ contextText }`,
        'You classify standup updates. Reply strict JSON: {"sentiment": "...", "blocker": true/false, "risk": true/false, "reason": "..."}'
    );

    if (aiResult) {
        try {
            const parsed = JSON.parse(aiResult);
            return {
                sentiment: String(parsed.sentiment || 'NEUTRAL').toUpperCase(),
                blocker_detected: Boolean(parsed.blocker),
                risk_detected: Boolean(parsed.risk),
                risk_reason: parsed.reason || null
            };
        } catch (e) {
            // fall through to deterministic
        }
    }

    // Deterministic fallback.

    const blocker_detected = BLOCKER_KEYWORDS.some(k => text.includes(k));
    const risk_detected = RISK_KEYWORDS.some(k => text.includes(k));

    let sentiment = 'POSITIVE';
    if (NEGATIVE_SENTIMENTS.some(k => text.includes(k))) {
        sentiment = 'NEGATIVE';
    } else if (blocker_detected || risk_detected) {
        sentiment = 'NEUTRAL';
    }

    return {
        sentiment,
        blocker_detected,
        risk_detected,
        risk_reason: risk_detected
            ? 'Standup update mentions a potential risk or delay.'
            : (blocker_detected
                ? 'Standup update reports a blocker.'
                : null)
    };
}

// =============================================
// GENERATE SESSION-LEVEL INSIGHTS
// Deterministic aggregation when Groq is
// unavailable, AI-summary when the key exists.
//
// Returns: { summary, blockers: [], risks: [],
//            recommendations: [], sentiment }
// =============================================
async function generateSessionInsights(rows) {
    if (!rows || !rows.length) {
        return {
            summary: 'No responses recorded for this standup.',
            blockers: [],
            risks: [],
            recommendations: [
                'Follow up with team members who did not respond.'
            ],
            sentiment: 'NEUTRAL'
        };
    }

    const memberNames = new Set(
        rows.map(r => r.member_name)
            .filter(Boolean)
    );

    const blockers = rows
        .filter(r => r.blocker_detected)
        .map(r => (r.member_name
            ? `${ r.member_name }: ${ r.response || r.question }`
            : (r.response || r.question)));

    const risks = rows
        .filter(r => r.risk_detected ||
            (r.blocker_detected && r.work_item_title))
        .map(r => {
            const base = r.member_name
                ? `${ r.member_name } — ${ r.work_item_title || 'work item' }`
                : (r.work_item_title || 'work item');
            return `${ base }: ${ r.risk_reason || (r.blocker_detected ? 'blocked or at risk.' : '') }`.trimEnd();
        });

    const answeredCount = rows.filter(r => r.response).length;
    const totalCount = rows.length;

    // AI summary (only when the API key exists).
    const aiResult = await callGroq(
        `Generate a standup summary from ${ answeredCount }/${ totalCount } responses collected.\n\nResponses:\n${ rows.map(r => `- ${ r.member_name || 'Unknown' }: ${ r.response || '(no response)' } (${ r.sentiment || 'NEUTRAL' }${ r.blocker_detected ? ', blocker' : '' })`).join('\n') }\n\nReturn JSON: {"summary": "...", "recommendations": ["..."]}`,
        'You write concise daily-standup summaries. Reply strict JSON only.'
    );

    let summary = `Standup completed for ${ memberNames.size } member(s) across ${ totalCount } item(s).`;
    let recommendations = [];

    if (!answeredCount) {
        summary = 'Standup completed. No responses were received.';
        recommendations.push(
            'Follow up with team members who did not respond.'
        );
    } else if (answeredCount < totalCount) {
        summary = `Standup completed for ${ memberNames.size } member(s) — ${ answeredCount }/${ totalCount } responses received.`;
        recommendations.push(
            'Follow up with members whose responses are missing.'
        );
    } else {
        summary = `Standup completed for ${ memberNames.size } member(s) across ${ totalCount } work item(s).`;
    }

    if (aiResult) {
        try {
            const parsed = JSON.parse(aiResult);
            summary = parsed.summary || summary;
            recommendations = (parsed.recommendations || [])
                .filter(Boolean);
        } catch (e) {
            // keep deterministic value
        }
    }

    if (!recommendations.length) {
        if (risks.length) {
            recommendations.push(
                'Review flagged risks and blockers with the impacted members.'
            );
        }
        recommendations.push('Continue tracking open work items.');
    }

    // Aggregate sentiment across responses.
    const sentiments = rows
        .map(r => r.sentiment)
        .filter(Boolean);
    const sentiment = sentiments.includes('NEGATIVE')
        ? 'NEGATIVE'
        : (sentiments.includes('NEUTRAL')
            ? 'NEUTRAL'
            : 'POSITIVE');

    return {
        summary,
        blockers,
        risks,
        recommendations,
        sentiment
    };
}

// =============================================
// RISK / DECISION ENGINE
// Decides whether a session needs escalation.
//
// Returns: { escalated, severity, escalationReasons: [] }
// =============================================
const NO_RESPONSE_SEVERITY = 'HIGH';
const RISK_SEVERITY = 'MEDIUM';

function assessSessionEscalation(rows) {
    const escalationReasons = [];
    let severity = 'LOW';

    for (const row of rows || []) {
        const name = row.member_name || 'Unknown';

        if (row.question_status === 'NO_RESPONSE') {
            escalationReasons.push(
                `${ name } did not respond before the deadline.`
            );
            severity = NO_RESPONSE_SEVERITY;
        }

        if (row.blocker_detected) {
            escalationReasons.push(
                `${ name } reported a blocker.`
            );
            severity = 'HIGH';
        }

        if (row.risk_detected && severity !== 'HIGH') {
            escalationReasons.push(
                `${ name } flagged a risk.`
            );
            severity = severity === NO_RESPONSE_SEVERITY
                ? severity
                : RISK_SEVERITY;
        }
    }

    return {
        escalated: escalationReasons.length > 0,
        severity,
        escalationReasons
    };
}

// =============================================
// PROPOSE AZURE DEVOPS UPDATES FROM ANSWERS
// For every answered ticket question, propose a
// status change + a polished comment that can be
// pushed to the Azure DevOps board after explicit
// user confirmation (web chat "Confirm Updates").
//
// AI-first: Groq returns strict JSON
//   [{ "ticketId": "101", "proposedStatus": "Done",
//      "comment": "JWT validation and token
//                  expiration handling completed." }]
// Deterministic fallback (no key / parse failure):
//   comment = the member's own response text,
//   status  = keyword-mapped (completed/done -> Done,
//             working on/started -> In Progress,
//             otherwise the ticket's current state).
//
// Returns: [{ ticketId, title, currentState,
//             proposedStatus, comment }]
// =============================================

const DONE_HINTS = [
    'completed', 'done', 'finished', 'fixed', 'closed',
    'merged', 'deployed', 'shipped', 'resolved'
];

const IN_PROGRESS_HINTS = [
    'working on', 'in progress', 'started', 'developing',
    'testing', 'ongoing', 'continuing', 'wip'
];

function fallbackStatusFor(responseText, currentState) {
    const t = String(responseText || '').toLowerCase();

    if (DONE_HINTS.some(k => t.includes(k))) {
        return 'Done';
    }
    if (IN_PROGRESS_HINTS.some(k => t.includes(k))) {
        return 'In Progress';
    }
    return currentState || 'In Progress';
}

async function proposeWorkItemUpdates(rows) {
    const items = (rows || []).filter(r => r.response && r.ticket_id);

    if (!items.length) {
        return [];
    }

    const ticketLines = items.map(r =>
        `- ticketId: "${ r.ticket_id }", title: "${ r.work_item_title || '' }", ` +
        `currentState: "${ r.work_item_state || '' }", ` +
        `memberResponse: "${ String(r.response).replace(/\s+/g, ' ').trim() }"`
    ).join('\n');

    const aiResult = await callGroq(
        `For each standup answer below, propose an Azure DevOps work-item update.\n` +
        `Infer the new state from the response (e.g. work completed -> "Done", ` +
        `still working -> "In Progress") and write a short polished past-tense comment.\n` +
        `Reply with strict JSON only: an array of ` +
        `{"ticketId":"<id>","proposedStatus":"<state>","comment":"<text>"}\n\n` +
        ticketLines,
        'You convert daily standup answers into Azure DevOps work-item updates. Reply strict JSON only.'
    );

    let proposals = null;
    if (aiResult) {
        try {
            const parsed = JSON.parse(aiResult);
            if (Array.isArray(parsed)) {
                proposals = parsed;
            }
        } catch (e) {
            // keep deterministic fallback
        }
    }

    return items.map(r => {
        const p = proposals
            ? proposals.find(x => String(x.ticketId) === String(r.ticket_id))
            : null;

        return {
            ticketId: String(r.ticket_id),
            title: r.work_item_title || '',
            currentState: r.work_item_state || '',
            proposedStatus:
                p && p.proposedStatus
                    ? p.proposedStatus
                    : fallbackStatusFor(r.response, r.work_item_state),
            comment:
                p && p.comment
                    ? String(p.comment).trim()
                    : String(r.response).trim()
        };
    });
}

module.exports = {
    generateDynamicQuestion,
    analyzeResponse,
    generateSessionInsights,
    assessSessionEscalation,
    proposeWorkItemUpdates
};
