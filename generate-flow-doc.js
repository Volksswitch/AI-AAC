// Standalone memo describing the revised partner-speech capture flow.
// Styled to match the Architecture Overview (Arial, blue headings, centered footer).
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat,
        HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber } = require('docx');

const PAGE_W = 12240;
const MARGIN = 1440;

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function heading2(text) {
    return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function para(text, opts = {}) {
    return new Paragraph({
        spacing: { before: 0, after: opts.after ?? 160 },
        children: [new TextRun({ text, ...opts.run })]
    });
}
function boldPara(label, text, after = 140) {
    return new Paragraph({
        spacing: { before: 0, after },
        children: [new TextRun({ text: label, bold: true }), new TextRun(text)]
    });
}
function bullet(text) {
    return new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0, after: 80 },
        children: [new TextRun(text)]
    });
}
function numberedItem(text) {
    return new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        spacing: { before: 0, after: 80 },
        children: [new TextRun(text)]
    });
}
function emptyPara() { return new Paragraph({ children: [] }); }

function simpleTable(headers, rows, widths) {
    const headerCell = (text, w) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: "D5E8F0" },
        margins: cellMargins,
        children: [new Paragraph({ spacing: { before: 0, after: 0 },
            children: [new TextRun({ text, bold: true, size: 20 })] })]
    });
    const bodyCell = (text, w) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        margins: cellMargins,
        children: [new Paragraph({ spacing: { before: 0, after: 0 },
            children: [new TextRun({ text, size: 20 })] })]
    });
    return new Table({
        width: { size: 9360, type: WidthType.DXA },
        borders,
        rows: [
            new TableRow({ tableHeader: true, children: headers.map((h, i) => headerCell(h, widths[i])) }),
            ...rows.map(r => new TableRow({ children: r.map((c, i) => bodyCell(c, widths[i])) }))
        ]
    });
}

const doc = new Document({
    styles: {
        default: { document: { run: { font: "Arial", size: 24 } } },
        paragraphStyles: [
            { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
                run: { size: 28, bold: true, font: "Arial", color: "1F4E79" },
                paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
        ]
    },
    numbering: {
        config: [
            { reference: "bullets",
                levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
                    style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
            { reference: "numbers",
                levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
                    style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        ]
    },
    sections: [{
        properties: { page: { size: { width: PAGE_W, height: 15840 },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        headers: { default: new Header({ children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "AI-Driven AAC — Partner Speech Capture", italics: true, color: "808080", size: 18, font: "Arial" })]
        })]})},
        footers: { default: new Footer({ children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({ text: "Volksswitch.org  |  June 2026  |  For internal use  |  Page ", size: 18, font: "Arial", color: "808080" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Arial", color: "808080" })
            ]
        })]})},
        children: [
            new Paragraph({
                spacing: { before: 240, after: 80 },
                children: [new TextRun({ text: "Continuous Partner Capture", bold: true, color: "1F4E79", size: 40, font: "Arial" })]
            }),
            new Paragraph({
                spacing: { before: 0, after: 240 },
                children: [new TextRun({ text: "A revised conversational flow for partner speech recording", italics: true, color: "595959", size: 26, font: "Arial" })]
            }),

            heading2("The Problem"),
            para("Knowing when a person has finished speaking is genuinely hard — and it is hardest for the communication partner, who pauses mid-thought, resumes, qualifies what they just said, and circles back. The earlier design used a single silence timeout to decide the partner was done: after the configured number of seconds of silence, recording stopped and the collected speech was sent to the AI. That forces the system to guess whether the partner has actually finished. Guess too early and the partner is cut off mid-utterance; wait longer to be safe and the user sits through avoidable delay on every turn."),
            emptyPara(),

            heading2("The Revised Model"),
            para("The silence period is no longer a stop — it is a checkpoint. In Settings it is now labeled the “Optional Responses silence period.” When the partner goes quiet for that period, the system takes the speech collected so far and sends it to the AI for response options, and speaks a placeholder to hold the conversational floor — but it keeps recording. Recording stops only when the user chooses a response."),
            para("If the partner resumes talking, the new speech is appended to what was already captured. After the next silence period, the combined speech is sent to the AI for a fresh, more complete set of options, and another placeholder is spoken. This repeats for as long as the partner keeps going — every pause yields an updated set of options built on everything said so far. The user may select a response at any moment; doing so stops recording, speaks the response, and stores the exchange."),
            emptyPara(),

            heading2("Step by Step"),
            numberedItem("The user taps Start Listening. The partner begins speaking; the live transcript appears on screen."),
            numberedItem("The partner pauses for the silence period. The speech so far is sent to the AI for response options; a placeholder is spoken. Recording continues."),
            numberedItem("If the partner resumes, the new speech is appended. The next silence period sends the combined speech for a new set of options and speaks another placeholder."),
            numberedItem("Steps 2–3 repeat for as long as the partner keeps talking."),
            numberedItem("The user selects a response at any time. Recording stops, the response is spoken, and the exchange is stored."),
            emptyPara(),

            heading2("Two Supporting Guarantees"),
            boldPara("Latest set of options wins. ", "Because each checkpoint starts its own request to the AI, an earlier request may still be in flight when a later one fires. The system tags each request and discards any result that a newer checkpoint has superseded, so the options on screen never flicker backward to a less complete answer."),
            boldPara("“Please repeat what you said.” ", "A persistent response option, always visible regardless of what else is on screen. Selecting it speaks the phrase to the partner, discards everything collected for the current exchange, and keeps listening for the partner’s restatement. Nothing is stored. It is the user’s escape hatch when the captured speech is garbled or they simply did not follow."),
            emptyPara(),

            heading2("Why Cleanup Happens Only at the End"),
            para("Throughout the exchange, options are generated directly from the raw speech-to-text — there is no transcript-cleanup step at each checkpoint. The single cleanup pass runs only after the user has selected and the response has been spoken, so it never delays the user’s words; its only job is to improve the text carried into the context of future turns. The persistent “Please repeat what you said.” control is what makes this safe: when a capture is too garbled to work with, the user disposes of it outright rather than relying on automated cleanup. If raw-text quality proves to be a problem in practice, per-checkpoint cleanup can be reintroduced."),
            emptyPara(),

            heading2("Settings Summary"),
            simpleTable(
                ["Setting", "Meaning under the revised flow"],
                [
                    ["Optional Responses silence period", "How long the partner can pause before the speech collected so far is sent for response options. Recording continues; the combined speech is re-sent after each subsequent pause. (Formerly “Silence Threshold,” which stopped recording.)"],
                    ["Placeholder timing", "Governs the filler spoken to hold the floor while options are generated. A placeholder fires at each silence checkpoint."]
                ],
                [3400, 5960]
            ),
            emptyPara(),

            heading2("Relationship to the Conversation-Analysis Design Layer"),
            para("This is a pragmatic Phase 1 realization of the end-of-utterance problem framed in the Conversation Engine design. Rather than classify each pause as complete, incomplete, or continuing and act differently for each, Phase 1 treats every pause as provisional: it offers options on what has been heard so far, but never commits, and simply regenerates as the utterance grows. The three-way end-of-utterance classifier and the escalating filler ladder described in that design refine this behavior in later phases without changing the basic guarantee — that the partner is never cut off and the user is never blocked from responding."),

            new Paragraph({
                border: { top: { style: BorderStyle.SINGLE, size: 4, space: 8, color: "CCCCCC" } },
                spacing: { before: 480, after: 0 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Implemented June 2026. See the Architecture Overview, Section 9, for placement within the Phase 1 implementation.", italics: true, color: "808080", size: 18 })]
            }),
        ]
    }]
});

Packer.toBuffer(doc).then(buffer => {
    fs.writeFileSync("Continuous-Partner-Capture.docx", buffer);
    console.log("Continuous-Partner-Capture.docx generated.");
});
