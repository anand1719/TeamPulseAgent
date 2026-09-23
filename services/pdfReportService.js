// =============================================
// pdfReportService.js
// Renders the end-of-standup summary as a PDF -
// the downloadable companion to the Adaptive
// "Standup Summary" card that is posted in chat.
//
//   - renderSummaryReportPdf(data)   : pure renderer
//     (no DB access) -> Promise<Buffer>
//   - generateSummaryReportPdf(id)   : loads the
//     session + insight + joined question/response
//     rows, then renders -> Promise<{...}>
//   - buildReportFileName(...)       : safe download
//     name for the Content-Disposition header
//
// Only pdfkit's built-in fonts are used (no font
// files to ship), so text is transliterated to a
// WinAnsi-safe subset first: typographic quotes and
// dashes are mapped to ASCII and emoji/other glyphs
// the standard fonts cannot encode are dropped
// (they would otherwise render as garbage).
// =============================================

const PDFDocument = require('pdfkit');

const { getSession } = require('./standupService');
const { getReport } = require('./reportService');
const { getSessionQuestions } = require('./questionService');
const { getWorkItemStates } = require('./azureDevopsService');

// =============================================
// THEME (matches the Fluent/Teams palette)
// =============================================

const BRAND = '#0F6CBD';
const INK = '#242424';
const MUTED = '#616161';
const RULE = '#D1D1D1';
const ZEBRA = '#F5F5F5';

const PAGE_MARGIN = 50;

// =============================================
// TEXT SANITISATION
// pdfkit's standard fonts are single-byte
// (WinAnsi), so anything outside that range would
// be dropped or garbled. Map the common typographic
// characters to ASCII, then strip the rest.
// =============================================

const TRANSLITERATIONS = {
    '\u2018': "'", '\u2019': "'", '\u201a': ',', '\u201b': "'",
    '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"',
    '\u2013': '-', '\u2014': '--', '\u2015': '--',
    '\u2026': '...', '\u2022': '-', '\u00b7': '-',
    '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ',
    '\u2192': '->', '\u2190': '<-', '\u2265': '>=', '\u2264': '<=',
    '\u2260': '!=', '\u00d7': 'x', '\u2713': 'OK', '\u2714': 'OK'
};

function sanitizeText(value, fallback) {
    if (value === null || value === undefined) {
        return fallback === undefined ? '' : fallback;
    }

    let text = String(value);

    text = text.replace(
        /[\u2018-\u201f\u2013-\u2015\u2026\u2022\u00b7\u00a0\u2009\u202f\u2190-\u22ff\u2713\u2714]/g,
        (char) => TRANSLITERATIONS[char] || ''
    );

    // Keep printable ASCII + Latin-1 supplement only.
    text = text.replace(/[^\x20-\x7e\xa0-\xff]/g, '');

    return text.replace(/[ \t]+/g, ' ').trim() ||
        (fallback === undefined ? '' : fallback);
}

// =============================================
// FORMATTING HELPERS
// =============================================

function toDate(value) {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
}

function pad(number) {
    return String(number).padStart(2, '0');
}

// Local-calendar formatting: standup_date is a DATE
// column, so using the local components keeps the day
// the team actually ran the standup (a UTC conversion
// would shift it back a day for IST).
function formatDate(value) {
    const date = toDate(value);
    if (!date) {
        return 'n/a';
    }
    return `${ pad(date.getDate()) }/${ pad(date.getMonth() + 1) }/${ date.getFullYear() }`;
}

function formatDateTime(value) {
    const date = toDate(value);
    if (!date) {
        return 'n/a';
    }
    return `${ formatDate(date) } ${ pad(date.getHours()) }:${ pad(date.getMinutes()) }`;
}

// Clock time only (HH:MM). The session date and the session time are
// reported as separate values, so the time is formatted on its own.
function formatClock(value) {
    const date = toDate(value);
    if (!date) {
        return null;
    }
    return `${ pad(date.getHours()) }:${ pad(date.getMinutes()) }`;
}

// The moment the standup actually began. started_at is written when the
// session starts; questions_sent_at is the same instant and acts as the
// fallback for any row that predates/omits started_at.
function sessionStartValue(session) {
    if (!session) {
        return null;
    }
    return toDate(session.started_at)
        ? session.started_at
        : session.questions_sent_at;
}

// "16/09/2026 20:01" - session date plus start time, degrading to the
// date alone when the time is unknown so the label never reads "n/a n/a".
function sessionDateTimeLabel(session) {
    const dateLabel = formatDate(session && session.standup_date);
    const timeLabel = formatClock(sessionStartValue(session));

    if (dateLabel === 'n/a') {
        return timeLabel || 'n/a';
    }

    return timeLabel ? `${ dateLabel } ${ timeLabel }` : dateLabel;
}

function titleCase(value, fallback) {
    const text = sanitizeText(value);
    if (!text) {
        return fallback === undefined ? 'n/a' : fallback;
    }
    return text.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function slug(value, fallback) {
    const text = sanitizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return text || fallback;
}

// =============================================
// LAYOUT PRIMITIVES
// =============================================

function contentWidth(doc) {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

// Start a new page when the next block would not fit,
// so headings never get orphaned at the page bottom.
function ensureSpace(doc, needed) {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + needed > bottom) {
        doc.addPage();
    }
}

function sectionHeading(doc, text, subtitle) {
    ensureSpace(doc, 48);

    doc.moveDown(0.6)
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(BRAND)
        .text(sanitizeText(text).toUpperCase(), { characterSpacing: 0.5 });

    if (subtitle) {
        doc.moveDown(0.15)
            .font('Helvetica')
            .fontSize(9)
            .fillColor(MUTED)
            .text(sanitizeText(subtitle));
    }

    doc.moveDown(0.3);
    const ruleY = doc.y;
    doc.moveTo(doc.page.margins.left, ruleY)
        .lineTo(doc.page.margins.left + contentWidth(doc), ruleY)
        .lineWidth(1)
        .strokeColor(RULE)
        .stroke();

    doc.moveDown(0.5).fillColor(INK);
}

function paragraph(doc, text, options) {
    const opts = options || {};
    const body = sanitizeText(text);
    if (!body) {
        return;
    }

    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.size || 10)
        .fillColor(opts.color || INK);

    const height = doc.heightOfString(body, { width: contentWidth(doc) });
    ensureSpace(doc, height + 4);

    doc.text(body, { width: contentWidth(doc), align: opts.align || 'left' });
    doc.moveDown(opts.after === undefined ? 0.4 : opts.after);
}

function bulletList(doc, items) {
    const list = (items || []).map(item => sanitizeText(item)).filter(Boolean);
    if (!list.length) {
        return;
    }

    const indent = 12;
    const width = contentWidth(doc) - indent;
    doc.font('Helvetica').fontSize(10);

    for (const item of list) {
        const height = doc.heightOfString(item, { width });
        ensureSpace(doc, height + 3);

        const top = doc.y;
        doc.fillColor(BRAND).text('\u2022', doc.page.margins.left, top, { width: indent });
        doc.fillColor(INK).text(item, doc.page.margins.left + indent, top, { width });
        doc.y = top + height + 3;
    }

    doc.moveDown(0.5);
}

// Two-column label/value grid used for the session
// metadata block. Each pair is measured before it is
// drawn so a pair never straddles a page boundary.
function metaGrid(doc, pairs) {
    const columnWidth = contentWidth(doc) / 2;
    const rows = [];

    for (let index = 0; index < pairs.length; index += 2) {
        rows.push(pairs.slice(index, index + 2));
    }

    for (const row of rows) {
        // Each pair is a label line with its value directly underneath, so
        // the two are measured separately and the value is offset by the
        // label height. Drawing both at the same y painted the label and the
        // value on top of each other.
        const cells = row.map(pair => {
            const label = `${ sanitizeText(pair[0]) }:`;
            const value = sanitizeText(pair[1], 'n/a');

            doc.font('Helvetica-Bold').fontSize(9);
            const labelHeight = doc.heightOfString(label, { width: columnWidth - 8 });

            doc.font('Helvetica').fontSize(9);
            const valueHeight = doc.heightOfString(value, { width: columnWidth - 8 });

            return { label, value, labelHeight, valueHeight };
        });

        const rowHeight = Math.max(
            ...cells.map(cell => cell.labelHeight + cell.valueHeight + 1)
        );

        ensureSpace(doc, rowHeight + 6);
        const top = doc.y;

        cells.forEach((cell, columnIndex) => {
            const x = doc.page.margins.left + columnIndex * columnWidth;

            doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
                .text(cell.label, x, top, { width: columnWidth - 8 });

            doc.font('Helvetica').fontSize(9).fillColor(INK)
                .text(cell.value, x, top + cell.labelHeight, { width: columnWidth - 8 });
        });

        doc.y = top + rowHeight + 5;
        doc.x = doc.page.margins.left;
    }
}
// =============================================
// BADGES / STAT CARDS / TABLE
// =============================================

// Maps a lifecycle state, sentiment or risk level onto
// a colour pair, so the PDF scans as quickly as the
// Adaptive Card does in chat.
function toneFor(value) {
    const text = sanitizeText(value).toUpperCase();

    if (/NO_RESPONSE|NO RESPONSE|BLOCKED|HIGH|NEGATIVE|CRITICAL|ESCALAT|FAILED|MISSED/
        .test(text)) {
        return 'danger';
    }

    if (/PENDING|IN_PROGRESS|IN PROGRESS|MEDIUM|NEUTRAL|WAITING|STARTED/.test(text)) {
        return 'warn';
    }

    if (/ANSWERED|DONE|CLOSED|RESOLVED|COMPLETED|LOW|POSITIVE/.test(text)) {
        return 'ok';
    }

    return 'neutral';
}

function tonePalette(tone) {
    switch (tone) {
        case 'ok':
            return { fill: '#E3F4E9', text: '#1B6B3A' };
        case 'warn':
            return { fill: '#FDF0DA', text: '#8A5A08' };
        case 'danger':
            return { fill: '#FBE3E3', text: '#9B1C1C' };
        case 'info':
            return { fill: '#E4EDFB', text: '#1D4ED8' };
        default:
            return { fill: '#ECEFF3', text: '#495057' };
    }
}

// Draws a horizontal strip of rounded status chips,
// wrapping onto extra lines when the row is full.
function chipRow(doc, chips, options) {
    const opts = options || {};
    const items = (chips || []).filter(chip => chip && sanitizeText(chip.label));

    if (!items.length) {
        return;
    }

    const paddingX = 8;
    const chipHeight = 18;
    const gap = 6;
    const maxWidth = contentWidth(doc);

    doc.font('Helvetica-Bold').fontSize(9);

    // Pre-measure so the rows can be balanced before drawing.
    const measured = items.map(chip => {
        const label = sanitizeText(chip.label);
        const width = Math.min(doc.widthOfString(label) + paddingX * 2, maxWidth);

        return { label, tone: chip.tone || toneFor(label), width };
    });

    const rows = [];
    let current = [];
    let used = 0;

    for (const chip of measured) {
        if (current.length && used + gap + chip.width > maxWidth) {
            rows.push(current);
            current = [];
            used = 0;
        }

        used += (current.length ? gap : 0) + chip.width;
        current.push(chip);
    }

    if (current.length) {
        rows.push(current);
    }

    ensureSpace(doc, rows.length * (chipHeight + gap) + 4);
    let y = doc.y;

    for (const row of rows) {
        let x = doc.page.margins.left;

        for (const chip of row) {
            const palette = tonePalette(chip.tone);

            doc.roundedRect(x, y, chip.width, chipHeight, chipHeight / 2)
                .fillColor(palette.fill)
                .fill();

            doc.fillColor(palette.text)
                .text(chip.label, x, y + 5, { width: chip.width, align: 'center' });

            x += chip.width + gap;
        }

        y += chipHeight + gap;
    }

    doc.y = y + (opts.after === undefined ? 4 : opts.after);
    doc.x = doc.page.margins.left;
}

// Row of headline numbers (total questions, answered, ...).
function statCards(doc, stats) {
    const items = (stats || []).filter(stat => stat && stat.label);

    if (!items.length) {
        return;
    }

    const gap = 8;
    const width = (contentWidth(doc) - gap * (items.length - 1)) / items.length;
    const height = 46;

    ensureSpace(doc, height + 8);
    const top = doc.y;

    items.forEach((stat, index) => {
        const x = doc.page.margins.left + index * (width + gap);
        const palette = tonePalette(stat.tone || toneFor(stat.label));

        doc.roundedRect(x, top, width, height, 6)
            .fillColor(palette.fill)
            .fill();

        doc.fillColor(palette.text)
            .font('Helvetica-Bold').fontSize(17)
            .text(sanitizeText(stat.value, '0'), x, top + 7, { width, align: 'center' });

        doc.font('Helvetica').fontSize(8)
            .text(sanitizeText(stat.label).toUpperCase(), x, top + 29, { width, align: 'center' });
    });

    doc.y = top + height + 10;
    doc.x = doc.page.margins.left;
    doc.fillColor(INK);
}

// Header labels are uppercased and drawn on a single line inside a
// fixed-height band. pdfkit breaks a word mid-letter when it is wider
// than its column (an 8.5pt "QUESTIONS" is 50.0pt wide but only 49.4pt
// of column is available, so it rendered as "QUESTION" / "S"; likewise
// "ANSWERED"), so the whole header row shares the largest size at
// which every label still fits.
function headerFontSize(doc, labels, available) {
    for (let size = 8.5; size >= 6.5; size -= 0.5) {
        doc.font('Helvetica-Bold').fontSize(size);

        const fits = labels.every((label, index) =>
            doc.widthOfString(label) <= available[index]);

        if (fits) {
            return size;
        }
    }

    return 6.5;
}

// Generic zebra-striped, wrapping, page-breaking table.
// columns: [{ key, label, width (0-1 fraction), align }]
function dataTable(doc, options) {
    const columns = options.columns || [];
    const rows = options.rows || [];

    if (!columns.length) {
        return;
    }

    const padding = 5;
    const total = contentWidth(doc);
    const widths = columns.map(column => total * (column.width || 1 / columns.length));
    const labels = columns.map(column => sanitizeText(column.label).toUpperCase());
    const headerSize = headerFontSize(
        doc,
        labels,
        widths.map(width => width - padding * 2)
    );

    const drawHeader = () => {
        const height = 20;
        // Captured once: reading doc.y inside the loop would
        // drift lower for every column, because writing text
        // advances doc.y.
        const top = doc.y;

        doc.rect(doc.page.margins.left, top, total, height)
            .fillColor(BRAND)
            .fill();

        let x = doc.page.margins.left;
        labels.forEach((label, index) => {
            doc.fillColor('#FFFFFF')
                .font('Helvetica-Bold').fontSize(headerSize)
                .text(
                    label,
                    x + padding,
                    top + 6,
                    { width: widths[index] - padding * 2, align: columns[index].align || 'left' }
                );

            x += widths[index];
        });

        doc.y = top + height;
        doc.x = doc.page.margins.left;
    };

    if (!rows.length) {
        paragraph(doc, options.emptyText || 'No records for this section.', { size: 9, color: MUTED });
        return;
    }

    drawHeader();

    rows.forEach((row, rowIndex) => {
        doc.font('Helvetica').fontSize(8.5);

        const cells = columns.map((column, index) =>
            sanitizeText(row[column.key], '-').replace(/\s*\n\s*/g, ' '));

        const heights = cells.map((text, index) =>
            doc.heightOfString(text, { width: widths[index] - padding * 2 }));

        const rowHeight = Math.max(...heights, 11) + padding * 2;
        const bottom = doc.page.height - doc.page.margins.bottom;

        // A row that would straddle the page boundary moves
        // to the next page, and the header repeats there.
        if (doc.y + rowHeight > bottom) {
            doc.addPage();
            drawHeader();
            doc.font('Helvetica').fontSize(8.5);
        }

        const top = doc.y;

        if (rowIndex % 2 === 1) {
            doc.rect(doc.page.margins.left, top, total, rowHeight)
                .fillColor(ZEBRA)
                .fill();
        }

        let x = doc.page.margins.left;
        cells.forEach((text, index) => {
            doc.fillColor(INK).text(text, x + padding, top + padding, {
                width: widths[index] - padding * 2,
                align: columns[index].align || 'left'
            });

            x += widths[index];
        });

        doc.moveTo(doc.page.margins.left, top + rowHeight)
            .lineTo(doc.page.margins.left + total, top + rowHeight)
            .lineWidth(0.5)
            .strokeColor(RULE)
            .stroke();

        doc.y = top + rowHeight;
        doc.x = doc.page.margins.left;
    });

    doc.moveDown(0.6);
}

// =============================================
// DOCUMENT / TITLE BLOCK / FOOTER
// =============================================

function buildPdfDocument(info) {
    return new PDFDocument({
        size: 'A4',
        // bufferPages lets the footer be stamped with the
        // real "Page X of Y" once all pages are rendered.
        bufferPages: true,
        margins: {
            top: PAGE_MARGIN,
            bottom: PAGE_MARGIN,
            left: PAGE_MARGIN,
            right: PAGE_MARGIN
        },
        info
    });
}

function drawTitleBlock(doc, meta) {
    const width = contentWidth(doc);
    const left = doc.page.margins.left;

    doc.rect(left, doc.page.margins.top, width, 4)
        .fillColor(BRAND)
        .fill();

    doc.y = doc.page.margins.top + 16;

    doc.font('Helvetica-Bold').fontSize(19).fillColor(INK)
        .text('Standup Summary Report', { width });

    doc.moveDown(0.15)
        .font('Helvetica').fontSize(11).fillColor(BRAND)
        .text(sanitizeText(meta.teamName, 'Team'), { width });

    doc.moveDown(0.1)
        .font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(
            `${ sanitizeText(meta.dateTimeLabel, 'n/a') } · Session #${ meta.sessionId }`,
            { width }
        );

    doc.moveDown(0.5);
    doc.fillColor(INK);
}

function stampFooters(doc, meta) {
    const range = doc.bufferedPageRange();

    for (let index = range.start; index < range.start + range.count; index += 1) {
        doc.switchToPage(index);

        // The footer sits inside the bottom margin, so the
        // margin is dropped for the write and then restored
        // (otherwise pdfkit would append another page).
        const originalBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        const pageNumber = index - range.start + 1;
        // Date, time and session number travel with every page, so a
        // printed or forwarded page still identifies its standup.
        const label = [
            'Smart Standup Agent',
            `Session #${ meta.sessionId }`,
            meta.dateTimeLabel,
            `Page ${ pageNumber } of ${ range.count }`
        ].filter(Boolean).join('   |   ');

        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
            .text(label, doc.page.margins.left, doc.page.height - 38, {
                width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
                align: 'center',
                lineBreak: false
            });

        // Thin rule above the footer text.
        doc.moveTo(doc.page.margins.left, doc.page.height - 46)
            .lineTo(doc.page.width - doc.page.margins.right, doc.page.height - 46)
            .lineWidth(0.5)
            .strokeColor(RULE)
            .stroke();

        doc.page.margins.bottom = originalBottom;
    }
}
// =============================================
// DERIVED DATA
// The same insights the card shows are stored as
// " | "-separated strings, and per-question detail
// comes from the joined question/response rows, so
// everything below works off those two sources.
// =============================================

function splitInsightField(value) {
    return String(value === null || value === undefined ? '' : value)
        .split('|')
        .map(part => sanitizeText(part))
        .filter(Boolean);
}

function statusLabel(row) {
    const status = sanitizeText(row.question_status, 'PENDING').toUpperCase();

    if (status === 'NO_RESPONSE') {
        return 'No response';
    }

    return titleCase(status.replace(/_/g, ' '), 'Pending');
}

// Flattens the per-question rows into one line per member
// for the participation table.
function summarizeMembers(rows) {
    const byMember = new Map();

    for (const row of rows || []) {
        const name = sanitizeText(row.member_name) || sanitizeText(row.asked_to) || 'Unknown';
        const entry = byMember.get(name) || {
            member: name,
            email: sanitizeText(row.member_email, '-'),
            questions: 0,
            answered: 0,
            noResponse: 0,
            pending: 0,
            blockers: 0
        };

        entry.questions += 1;

        if (row.question_status === 'ANSWERED') {
            entry.answered += 1;
        } else if (row.question_status === 'NO_RESPONSE') {
            entry.noResponse += 1;
        } else {
            entry.pending += 1;
        }

        if (row.blocker_detected) {
            entry.blockers += 1;
        }

        byMember.set(name, entry);
    }

    return [...byMember.values()];
}

// One bullet per flagged question (blocker / risk), naming
// the member, the ticket and the reason where available.
function flaggedLines(rows, flag) {
    return (rows || [])
        .filter(row => row[flag])
        .map(row => {
            const who = sanitizeText(row.member_name) || 'Member';
            const ticket = sanitizeText(row.ticket_id, 'no ticket');
            const title = sanitizeText(row.work_item_title);
            const reason = sanitizeText(row.risk_reason) ||
                sanitizeText(row.response) ||
                'flagged during standup';

            return `${ who } - ${ ticket }${ title ? ` (${ title })` : '' }: ${ reason }`;
        });
}

function buildStats(rows) {
    const list = rows || [];
    const answered = list.filter(row => row.question_status === 'ANSWERED').length;
    const noResponse = list.filter(row => row.question_status === 'NO_RESPONSE').length;
    const pending = Math.max(0, list.length - answered - noResponse);

    return [
        { label: 'Questions', value: list.length, tone: 'info' },
        { label: 'Answered', value: answered, tone: 'ok' },
        { label: 'No response', value: noResponse, tone: noResponse ? 'danger' : 'neutral' },
        { label: 'Pending', value: pending, tone: pending ? 'warn' : 'neutral' }
    ];
}

// Per-question detail rows for the main table.
function buildDetailRows(rows) {
    return (rows || []).map(row => ({
        member: sanitizeText(row.member_name, 'Unknown'),
        ticket: sanitizeText(row.ticket_id, '-'),
        item: sanitizeText(row.work_item_title, '-'),
        state: sanitizeText(row.work_item_state, '-'),
        status: statusLabel(row),
        response: sanitizeText(row.response) || sanitizeText(row.risk_reason) || '-'
    }));
}

// =============================================
// SECTION RENDERERS
// =============================================

// Bold label followed by bullets (or a muted "nothing
// reported" line) - used for the AI insight lists.
function labeledBullets(doc, label, items, emptyText) {
    const list = (items || []).filter(Boolean);

    ensureSpace(doc, 30);
    doc.x = doc.page.margins.left;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
        .text(sanitizeText(label), { width: contentWidth(doc) });

    doc.moveDown(0.25);

    if (list.length) {
        bulletList(doc, list);
        return;
    }

    paragraph(doc, emptyText, { size: 9, color: MUTED, after: 0.5 });
}

// Section 1: session metadata + the headline counts.
function renderOverview(doc, context) {
    const session = context.session || {};
    const rows = context.rows || [];

    sectionHeading(doc, 'Session overview', 'When the standup ran and how it finished.');

    // Session number, date and time lead the block, so every report
    // states which standup it belongs to and when it ran.
    metaGrid(doc, [
        ['Team', session.team_name],
        ['Session no', session.id],
        ['Session date', formatDate(session.standup_date)],
        ['Session time', formatClock(sessionStartValue(session)) || 'n/a'],
        ['Status', titleCase(session.status)],
        ['Lifecycle', titleCase(String(session.lifecycle_status || '').replace(/_/g, ' '))],
        ['Response deadline', formatDateTime(session.response_deadline)],
        ['Started', formatDateTime(session.started_at)],
        ['Completed', formatDateTime(session.completed_at)]
    ]);

    doc.moveDown(0.2);
    statCards(doc, buildStats(rows));
}

// Section 2: the same narrative the chat card shows,
// as prose plus per-topic bullets.
function renderInsights(doc, context) {
    const insight = context.insight || {};

    sectionHeading(doc, 'AI insights', 'Generated from the responses collected in this session.');

    paragraph(
        doc,
        sanitizeText(insight.summary) || 'No AI summary was generated for this session.',
        { after: 0.55 }
    );

    chipRow(doc, [
        insight.sentiment && {
            label: `Sentiment: ${ sanitizeText(insight.sentiment) }`,
            tone: toneFor(insight.sentiment)
        },
        insight.risk_level && {
            label: `Risk level: ${ sanitizeText(insight.risk_level) }`,
            tone: toneFor(insight.risk_level)
        }
    ]);

    labeledBullets(doc, 'Blockers', splitInsightField(insight.blockers), 'No blockers were reported.');
    labeledBullets(doc, 'Risks', splitInsightField(insight.risks), 'No risks were reported.');
    labeledBullets(doc, 'Recommendations', splitInsightField(insight.recommendations), 'No recommendations were generated.');
}

// Section 3: per-question blocker / risk flags. The
// section is skipped entirely when nothing was flagged,
// so the report stays short on a clean standup.
function renderFlags(doc, context) {
    const rows = context.rows || [];
    const blockers = flaggedLines(rows, 'blocker_detected');
    const risks = flaggedLines(rows, 'risk_detected');

    if (!blockers.length && !risks.length) {
        return;
    }

    sectionHeading(doc, 'Flags & escalations', 'Items the risk engine picked up from the responses.');

    if (blockers.length) {
        labeledBullets(doc, 'Blockers detected', blockers, 'None.');
    }

    if (risks.length) {
        labeledBullets(doc, 'Risks detected', risks, 'None.');
    }
}

// Section 4: one row per member.
function renderParticipationTable(doc, context) {
    const members = summarizeMembers(context.rows);

    sectionHeading(doc, 'Participation', 'Response status per team member.');

    dataTable(doc, {
        columns: [
            { key: 'member', label: 'Member', width: 0.24 },
            { key: 'email', label: 'Email', width: 0.3 },
            { key: 'questions', label: 'Questions', width: 0.12, align: 'center' },
            { key: 'answered', label: 'Answered', width: 0.11, align: 'center' },
            { key: 'noResponse', label: 'No resp.', width: 0.11, align: 'center' },
            { key: 'blockers', label: 'Blockers', width: 0.12, align: 'center' }
        ],
        rows: members,
        emptyText: 'No questions were sent in this session.'
    });
}

// Section 5: one row per question, with the saved response.
function renderDetailTable(doc, context) {
    const details = buildDetailRows(context.rows);

    sectionHeading(doc, 'Work item detail', 'Every standup question with its response.');

    dataTable(doc, {
        columns: [
            { key: 'member', label: 'Member', width: 0.15 },
            { key: 'ticket', label: 'Ticket', width: 0.11 },
            { key: 'item', label: 'Work item', width: 0.23 },
            { key: 'state', label: 'State', width: 0.11 },
            { key: 'status', label: 'Status', width: 0.12 },
            { key: 'response', label: 'Response', width: 0.28 }
        ],
        rows: details,
        emptyText: 'No questions were recorded for this session.'
    });
}
// =============================================
// FILE NAME
// =============================================

// Deterministic, filesystem-safe download name:
//   standup-summary-development-team-16-09-2026-session-12.pdf
function buildReportFileName(session) {
    const date = toDate(session && session.standup_date) || new Date();
    const datePart =
        `${ pad(date.getDate()) }-${ pad(date.getMonth() + 1) }-${ date.getFullYear() }`;
    const teamPart = slug(session && session.team_name, 'team');
    const sessionPart = session && session.id ? `-session-${ session.id }` : '';

    return `standup-summary-${ teamPart }-${ datePart }${ sessionPart }.pdf`;
}

// =============================================
// RENDERERS
// =============================================

function notFoundError(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
}

// Reads the freshest state known for numeric ticket ids.
//
// Sources, in descending priority:
//   1. live Azure DevOps System.State,
//   2. the confirmed applied_status persisted by the web-chat flow,
//   3. the work_items.state snapshot stored on the row.
function ticketIdKey(value) {
    return (value === null || value === undefined ? '' : String(value)).trim();
}

async function buildLiveStateByTicket(rows) {
    const ticketIds = [...new Set(
        (rows || [])
            .map(row => ticketIdKey(row.ticket_id))
            .filter(id => /^\d+$/.test(id))
    )];

    if (!ticketIds.length) {
        return new Map();
    }

    try {
        const liveStates = await getWorkItemStates(ticketIds);

        if (liveStates && liveStates.size) {
            return liveStates;
        }
    } catch (error) {
        console.error(
            'PDF Report: live work-item state refresh failed:',
            error.message
        );
    }

    return new Map();
}

function refreshRowState(row, liveStateByTicket) {
    const liveState = liveStateByTicket.get(ticketIdKey(row.ticket_id));
    const appliedState = row.ado_applied_status || null;

    return {
        ...row,
        work_item_state: liveState || appliedState || row.work_item_state
    };
}

// Replaces each row's snapshot state with the CURRENT state from
// Azure DevOps. Only numeric ticket ids are queried (non numeric
// external ids, e.g. Linear keys, would make ADO reject the whole
// batch) and the whole lookup is best effort: if ADO is slow or
// unreachable, the confirmed ado_updates row still wins over the
// stored snapshot, so the report always renders the best state known.
async function refreshWorkItemStates(rows) {
    const list = rows || [];

    const liveStateByTicket = await buildLiveStateByTicket(list);

    return list.map(row => refreshRowState(row, liveStateByTicket));
}

// Pulls the freshest known state for each numeric ticket id out of Azure
// DevOps. Azure DevOps fails the WHOLE batch when a single id is missing
// or not readable (e.g. a ticket deleted on the board, or a snapshot
// created from seed data), which would knock out the live states for
// every other ticket in the report - getWorkItemStates() handles that
// by falling back to per-ticket lookups.

// Pure renderer - takes everything it needs as an
// argument (no DB access), which keeps it testable and
// reusable for other report variants later.
async function renderSummaryReportPdf(data) {
    const input = data || {};
    const session = input.session || {};
    const insight = input.insight || null;
    const rows = input.rows || [];

    const generatedAt = input.generatedAt || new Date();
    const sessionId = session.id === undefined || session.id === null
        ? 'n/a'
        : session.id;

    const doc = buildPdfDocument({
        Title: `Standup Summary Report - ${ sanitizeText(session.team_name, 'Team') }`,
        Author: 'Smart Standup Agent',
        Subject: `Daily standup summary for session #${ sessionId }`,
        Creator: 'Smart Standup Agent',
        CreationDate: generatedAt
    });

    // pdfkit is a stream, so the buffer is collected while
    // the sections below are drawn, then stitched together.
    const chunks = [];
    const finished = new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    // Session date + time, shared by the title block and the per-page
    // footers.
    const dateTimeLabel = sessionDateTimeLabel(session);

    drawTitleBlock(doc, {
        teamName: session.team_name,
        dateTimeLabel,
        sessionId
    });

    paragraph(doc, `Generated on ${ formatDateTime(generatedAt) }`, {
        size: 8,
        color: MUTED,
        after: 0.2
    });

    const context = { session, insight, rows };

    renderOverview(doc, context);
    renderInsights(doc, context);
    renderFlags(doc, context);
    renderParticipationTable(doc, context);
    renderDetailTable(doc, context);

    // Needs the buffered pages, so it must run last.
    stampFooters(doc, { sessionId, dateTimeLabel });

    doc.end();

    const buffer = await finished;

    return {
        buffer,
        fileName: buildReportFileName(session),
        sessionId,
        generatedAt,
        questionCount: rows.length,
        byteLength: buffer.length
    };
}

// Loads a session, its AI insights and the joined
// question/response rows, then renders the PDF.
async function generateSummaryReportPdf(sessionId) {
    const id = Number(sessionId);

    if (!Number.isInteger(id) || id <= 0) {
        throw notFoundError(`Invalid standup session id: ${ sessionId }`);
    }

    const session = await getSession(id);

    if (!session) {
        throw notFoundError(`Standup session ${ id } was not found.`);
    }

    const [report, sessionRows] = await Promise.all([
        getReport(id),
        getSessionQuestions(id)
    ]);

    // work_items.state is a snapshot captured when the standup asked
    // about the ticket, so a ticket the team finished afterwards (or
    // that was moved to Done on the Azure DevOps board directly)
    // could be reported wrongly. Prefer live Azure DevOps state,
    // falling back to the confirmed ado_updates row and finally the
    // stored snapshot.
    const rows = await refreshWorkItemStates(sessionRows);

    const insight = (report && report.rows && report.rows[0]) || null;

    return renderSummaryReportPdf({ session, insight, rows });
}

module.exports = {
    generateSummaryReportPdf,
    renderSummaryReportPdf,
    buildReportFileName
};

