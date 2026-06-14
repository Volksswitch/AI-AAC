const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat, ExternalHyperlink,
        HeadingLevel, BorderStyle, WidthType, ShadingType,
        PageNumber, PageBreak, ImageRun } = require('docx');

const PAGE_W = 12240;
const MARGIN = 1440;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9360

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// Load diagram images
const phase1Img = fs.readFileSync('diagram-phase1.png');
const nthPhaseImg = fs.readFileSync('diagram-nthphase.png');

// Load conversation-design figures (from the June 2026 design documents)
const uiFig1 = fs.readFileSync('ui-fig1-anatomy.png');      // 1600x1000
const uiFig2 = fs.readFileSync('ui-fig2-card.png');         // 1600x820
const uiFig3 = fs.readFileSync('ui-fig3-modes.png');        // 1840x860
const uiFig4 = fs.readFileSync('ui-fig4-transcript.png');   // 1600x760
const uiFig5 = fs.readFileSync('ui-fig5-ladder.png');       // 1600x640
const uiFig6 = fs.readFileSync('ui-fig6-access.png');       // 1840x880
const uiFig7 = fs.readFileSync('ui-fig7-experiment-loop.png'); // 1600x760

function heading1(text) {
    return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
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
        children: [
            new TextRun({ text: label, bold: true }),
            new TextRun(text)
        ]
    });
}
function bullet(text, ref = "bullets") {
    return new Paragraph({
        numbering: { reference: ref, level: 0 },
        spacing: { before: 0, after: 80 },
        children: [new TextRun(text)]
    });
}
function bulletBold(label, text, ref = "bullets") {
    return new Paragraph({
        numbering: { reference: ref, level: 0 },
        spacing: { before: 0, after: 80 },
        children: [
            new TextRun({ text: label, bold: true }),
            new TextRun(text)
        ]
    });
}
function emptyPara() {
    return new Paragraph({ children: [] });
}
function numberedItem(text) {
    return new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        spacing: { before: 0, after: 80 },
        children: [new TextRun(text)]
    });
}

function imagePara(imgBuffer, widthInches, heightInches, altTitle) {
    return new Paragraph({
        spacing: { before: 120, after: 120 },
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({
            type: "png",
            data: imgBuffer,
            transformation: { width: widthInches * 72, height: heightInches * 72 },
            altText: { title: altTitle, description: altTitle, name: altTitle }
        })]
    });
}

// Caption + figure (figures from the design documents). widthPx/heightPx in pixels.
function figure(caption, imgBuffer, widthPx, heightPx, altTitle) {
    return [
        new Paragraph({
            spacing: { before: 80, after: 40 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: caption, bold: true, italics: true, color: "1F4E79", size: 20 })]
        }),
        new Paragraph({
            spacing: { before: 0, after: 200 },
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({
                type: "png", data: imgBuffer,
                transformation: { width: widthPx, height: heightPx },
                altText: { title: altTitle, description: altTitle, name: altTitle }
            })]
        })
    ];
}

// Monospace code/schema block, lightly shaded.
function codeBlock(lines) {
    return lines.map((line, i) => new Paragraph({
        spacing: { before: i === 0 ? 60 : 0, after: i === lines.length - 1 ? 160 : 0 },
        shading: { type: ShadingType.CLEAR, fill: "F2F4F7" },
        indent: { left: 240, right: 240 },
        children: [new TextRun({ text: line || " ", font: "Consolas", size: 18, color: "333333" })]
    }));
}

// Styled table matching the design-document aesthetic.
// headers: [str]; rows: [[str]]; widths: [twips] (must sum to ~9360)
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
            new TableRow({ tableHeader: true,
                children: headers.map((h, i) => headerCell(h, widths[i])) }),
            ...rows.map(r => new TableRow({
                children: r.map((c, i) => bodyCell(c, widths[i])) }))
        ]
    });
}

// Build the document
const doc = new Document({
    styles: {
        default: { document: { run: { font: "Arial", size: 24 } } },
        paragraphStyles: [
            { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
                run: { size: 32, bold: true, font: "Arial", color: "1F4E79" },
                paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
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
        properties: {
            page: {
                size: { width: PAGE_W, height: 15840 },
                margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }
            }
        },
        headers: {
            default: new Header({ children: [
                new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: "AI-Driven AAC — Architecture Overview", italics: true, color: "808080", size: 18, font: "Arial" })]
                })
            ]})
        },
        footers: {
            default: new Footer({ children: [
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: "Page ", size: 18, font: "Arial", color: "808080" }),
                        new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Arial", color: "808080" })
                    ]
                })
            ]})
        },
        children: [
            // ===== TITLE PAGE =====
            new Paragraph({
                spacing: { before: 480, after: 120 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "AI-Driven AAC System", bold: true, color: "1F4E79", size: 52, font: "Arial" })]
            }),
            new Paragraph({
                spacing: { before: 0, after: 80 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Architecture Overview", bold: true, color: "1F4E79", size: 44, font: "Arial" })]
            }),
            new Paragraph({
                spacing: { before: 0, after: 80 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Vision, Phase 1 Implementation, the Conversation-Analysis Design Layer, and Future Roadmap", italics: true, color: "595959", size: 28, font: "Arial" })]
            }),
            new Paragraph({
                spacing: { before: 0, after: 560 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Kenneth R. Hackbarth  |  Volksswitch.org  |  June 2026", color: "808080", size: 22, font: "Arial" })]
            }),

            // ===== 1. PROJECT VISION =====
            heading1("1.  Project Vision"),
            heading2("The Problem"),
            para("Augmentative and Alternative Communication (AAC) devices have, for decades, given non-speaking individuals a way to express basic needs and preferences. But they have consistently fallen short of enabling genuine real-time conversation — the kind that builds and sustains relationships, establishes influence, and allows full participation in society."),
            para("AAC users with significant motor limitations typically communicate at 10 to 20 words per minute. Comfortable conversation requires at least 80 words per minute. But the deeper barrier is not speed itself — it is the human aversion to awkward silence. Research shows that people become uncomfortable after as little as one to four seconds of silence in conversation. Repeated multi-second delays cause communication partners to interrupt, finish sentences for the AAC user, or disengage entirely."),
            para("The result is that AAC users are largely confined to transactional communication — expressing needs and wants — and rarely achieve interactional communication: telling jokes, sharing experiences, discussing ideas, building friendships, or exercising influence. This exclusion is not a matter of capability; it is a technology gap."),
            emptyPara(),

            heading2("The Proposed Solution"),
            para("Generative AI makes it possible to close that gap. Within seconds of a communication partner finishing a sentence, an AI system can generate several contextually appropriate, grammatically correct response options for the AAC user to choose from. The user selects one with a single tap; the device speaks it immediately. The conversation continues at or near natural speed."),
            para("Critically, the goal is not to speak for the AAC user but to speak as the AAC user — responses shaped by that person’s personality, opinions, relationships, and conversational goals. The user retains final control over every word spoken."),
            emptyPara(),

            // ===== 2. TARGET USER =====
            heading1("2.  Target User"),
            heading2("Initial Target"),
            para("The first version of the system is designed for:"),
            bullet("A non-speaking individual with cerebral palsy (CP)"),
            bullet("Literate (able to read response options on screen)"),
            bullet("Age 16 or older"),
            bullet("Using direct select (touch or pointer) as the primary access method"),
            emptyPara(),

            heading2("Planned Expansion"),
            para("Subsequent versions will expand accessibility to a wider range of users, including those with different motor profiles (switch access, eye gaze), different literacy levels (including pre-literate users via pictographic representations), and a broader age range. The architecture is designed with this expansion in mind from the start."),
            emptyPara(),

            // ===== 3. SYSTEM ARCHITECTURE =====
            heading1("3.  System Architecture"),
            para("The system is composed of five functional components. These mirror the architecture described in the author’s 2024 paper in Assistive Technology Outcomes and Benefits (ATOB, Vol. 18) and are elaborated here with implementation intent."),
            emptyPara(),

            boldPara("Component 1 — NLP In (Speech-to-Text): ", "Captures the communication partner’s spoken words and converts them to text. The transcript is displayed on screen so the AAC user can verify it was heard correctly before responding. This validation step is considered critical to system trustworthiness."),
            boldPara("Component 2 — Situational Awareness: ", "Gathers environmental context to inform response generation: physical location (GPS), identity of the communication partner (face/voice recognition), calendar context, and time of day. This component is planned for Phase 2."),
            boldPara("Component 3 — Statement/Response Generation: ", "The linchpin of the system. A large language model (LLM) — initially the Claude API from Anthropic — generates a small set of contextually appropriate response options in under three seconds. This is where the real-time communication breakthrough occurs."),
            boldPara("Component 4 — Statement/Response Shaping and Tuning: ", "Shapes the LLM’s output to reflect the specific AAC user’s personality, opinions, relationships, and goals. This is implemented via a worldview model built from a structured questionnaire and refined over time through user feedback. Retrieval-Augmented Generation (RAG) is used to keep token usage manageable as the profile grows. This is the most complex component and is planned for Phase 3."),
            boldPara("Component 5 — NLP Out (Text-to-Speech): ", "Converts the selected response to audible speech and plays it at an appropriate volume. Initial implementation uses the browser’s built-in TTS. A personalized or cloned voice is a planned future enhancement."),
            emptyPara(),

            // ===== 4. SUSTAINABILITY MODEL =====
            heading1("4.  Sustainability Model"),
            para("Previous attempts to build AI-driven AAC systems have been shelved when grant or institutional funding ran out. A server-based architecture — where the project pays for compute, storage, and AI API calls on behalf of all users — is inherently fragile. As the user base grows, so do costs, until the project becomes unsustainable."),
            para("This architecture addresses that failure mode in two ways:"),
            emptyPara(),
            bullet("No server infrastructure. The application is a static web app served from a platform like GitHub Pages. All processing happens in the user’s browser. There is no backend to operate or fund."),
            bullet("User-funded AI. Each user creates their own account with an AI provider (initially Anthropic) and supplies their own API key. The project incurs no AI API costs. Users start on the free tier and upgrade at their own discretion as their usage grows."),
            emptyPara(),
            para("This model scales to any number of users at near-zero marginal cost to the project, making it genuinely sustainable as an open-source, free product."),
            emptyPara(),

            // ===== 5. TECHNICAL DECISIONS =====
            heading1("5.  Technical Decisions"),
            emptyPara(),
            boldPara("Platform: ", "A static web app served from GitHub Pages (or equivalent). The user navigates to a URL in any modern browser. No installation required. No backend server."),
            boldPara("Target Hardware: ", "The browser’s File System Access API (FSA) is not supported on iOS or Android, and Apple does not produce a tablet-class Mac. The device must therefore run Windows and use Microsoft Edge or Google Chrome. The Microsoft Surface is the primary candidate hardware platform."),
            boldPara("Local Data Storage: ", "All user data — worldview profile, conversation history, API key — is stored locally on the user’s device using the browser’s File System Access API. The app requests permission to read and write a designated local folder. No user data is transmitted to any server other than the LLM API."),
            boldPara("AI Vendor: ", "Claude API (Anthropic) for the initial implementation. The architecture will be designed to support additional vendors (e.g., OpenAI) in future releases. The user’s API key is stored locally."),
            boldPara("STT Transcript Validation: ", "The text transcript of the communication partner’s speech is displayed on screen before response options are shown. This allows the AAC user to confirm the system heard correctly. This is a required feature, not optional."),
            boldPara("End-of-Utterance Detection: ", "The target behavior is automatic detection of when the communication partner has finished speaking, using silence detection. A manual trigger (e.g., a “Done listening” button) is acceptable for the initial version and will be replaced or supplemented with automatic detection in a later phase."),
            boldPara("Voice / Text-to-Speech: ", "The browser’s built-in TTS engine is used initially. A higher-quality or personalized (cloned) voice is a planned future enhancement — valuable but not required for the first version."),
            boldPara("Communication Partner: ", "The communication partner requires no device, app, or special knowledge. From their perspective, they are simply speaking with someone who uses a device to communicate."),
            boldPara("Cross-Device Data Transfer: ", "Data stays on the originating device. A future feature will allow users to export their profile as a file and import it on another device, using cloud storage services such as iCloud, Google Drive, or OneDrive as the transfer medium."),
            emptyPara(),

            // ===== 6. WORLDVIEW MODEL =====
            heading1("6.  Worldview Model"),
            para("A key differentiator of this system is the goal of speaking as the user, not merely for the user. To accomplish this, the system maintains a structured representation of who the AAC user is: their personality, opinions, interests, relationships, and conversational goals. This is called the worldview model."),
            para("The worldview model is used to shape the prompts sent to the LLM, so that the responses generated reflect what this specific person would likely want to say — not a generic response that any user might give."),
            emptyPara(),

            heading2("Minimum Viable Approach"),
            para("The minimum viable worldview model is a structured “getting to know you” questionnaire — a carefully selected set of questions covering interests, relationships, communication style, opinions, and goals. Key design constraints:"),
            bullet("Information gathering must be chunked into short sessions. For a CP user, extended data entry is physically exhausting. Each session should be brief and low-pressure."),
            bullet("Many common conversational exchanges — greetings, small talk, simple questions — require no worldview context at all. The system is functional at a reduced level of personalization even with zero questionnaire answers."),
            bullet("As the profile grows, Retrieval-Augmented Generation (RAG) will be used to select only the most relevant portions of the worldview for any given conversation, keeping token usage and latency manageable."),
            emptyPara(),
            para("The questionnaire is estimated to encompass approximately 100 questions, completed entirely at the user’s own pace. No question is required. Designing the specific questionnaire content is part of the work ahead."),
            emptyPara(),

            heading2("Conversational Worldview Collection"),
            para("Rather than presenting a traditional form-based questionnaire, the system will collect worldview information through AI-driven conversations. The AI initiates a natural, friendly dialogue — asking questions, following up on answers, and allowing the user to respond using the same response-option selection mechanism used in real conversations. This approach has several advantages:"),
            bullet("It uses the same interaction model the user already knows: the AI speaks, the user selects from response options, the device speaks the selected response."),
            bullet("It is less fatiguing than form entry — the user taps to respond rather than typing or dictating."),
            bullet("It naturally supports chunking: the user can stop and resume at any time, and the AI picks up where it left off."),
            bullet("It produces richer, more natural data than checkbox answers — the AI can follow up, clarify, and explore nuance."),
            para("This conversational approach to worldview collection is closely related to the Practice Communication Partner feature described in Section 8."),
            emptyPara(),

            // ===== 7. PHASED ROLLOUT =====
            heading1("7.  Phased Rollout"),
            para("The system is designed to deliver real value at each phase of development. Full functionality is not required for the system to be useful."),
            emptyPara(),

            boldPara("Phase 1 — Core Conversation Loop (Proof of Concept): ", "Speech-to-text captures the partner’s words and displays the transcript. The LLM generates response options. The user selects one. Text-to-speech speaks it. No worldview shaping, no situational awareness. This alone represents a breakthrough: real-time conversational participation that is currently impossible with existing AAC devices. Phase 1 development is complete; see Section 9 for implementation details."),
            bullet("Response options: Three by default, configurable. Options may appear in compressed form (a few words representing a fuller thought) to speed reading. The system may also read the hint aloud; the trigger is a user preference. The device speaks the fully expanded response after selection."),
            bullet("Conversation context: rolling window of the current session passed to the AI."),
            bullet("Conversation initiation: via canned conversation starters — pre-configured phrases the user can select to open a conversation, bypassing the listen/STT step. Situational awareness will suggest context-specific starters in Phase 2."),
            bullet("Placeholder utterances (e.g., “Just a second…”) automatically generated and spoken while the user selects a response. Customization supported."),
            emptyPara(),

            boldPara("Phase 2 — Situational Awareness: ", "Add location context (GPS), communication partner recognition (face/voice), and calendar integration. Responses become more contextually appropriate for the setting and the specific person being addressed. Canned conversation starters from Phase 1 are enhanced with contextually suggested options based on location and partner identity. Phase 2 also addresses several design refinements deferred from Phase 1 (see Section 14)."),
            emptyPara(),

            boldPara("Phase 3 — Worldview Shaping and Tuning: ", "Integrate the worldview model and the offline feedback loop. Responses are shaped to reflect the individual user’s personality and goals. The user reviews past conversations and rates response suggestions to continuously improve the system’s accuracy. RAG is employed to manage profile size. This phase makes the system speak as the user."),
            emptyPara(),

            // ===== 8. PRACTICE COMMUNICATION PARTNER =====
            heading1("8.  Practice Communication Partner"),
            para("A key planned feature is the ability for the system to act as a simulated communication partner, allowing the AAC user to practice conversations without requiring another person to be present. In this mode, the AI plays both roles: it generates the “partner” side of the conversation (spoken aloud via TTS) and then generates response options for the user to select, just as in a real conversation."),
            emptyPara(),

            heading2("Purpose and Value"),
            para("Practice mode serves multiple goals:"),
            bullet("Skill building: The user practices navigating conversations, selecting responses under time pressure, and developing confidence with the system’s interaction model before engaging in real conversations."),
            bullet("Scenario rehearsal: The AI simulates specific real-life scenarios — ordering at a restaurant, greeting a new colleague, discussing a medical concern with a doctor, making small talk at a party — so the user can rehearse before the situation arises."),
            bullet("System familiarity: New users can learn the interface and build muscle memory without the social pressure of a live conversation."),
            bullet("Worldview collection: The same conversational mechanism is used to collect worldview profile data. The AI initiates a friendly dialogue to learn about the user’s personality, opinions, interests, and communication preferences (see Section 6)."),
            emptyPara(),

            heading2("How It Works"),
            para("In practice mode, the conversation flow is:"),
            numberedItem("The AI generates a partner utterance appropriate to the selected scenario and speaks it aloud via TTS."),
            numberedItem("The utterance text is displayed in the transcript area, just as a real partner’s speech would be."),
            numberedItem("The AI generates response options for the user to choose from."),
            numberedItem("The user selects a response; the device speaks it."),
            numberedItem("The AI generates the next partner utterance based on the conversation so far, and the cycle continues."),
            emptyPara(),
            para("This reuses the entire Phase 1 conversation pipeline — the only difference is that the partner’s speech comes from the AI rather than from a microphone. The STT module is bypassed; the AI-generated text is fed directly to the transcript display and response generation modules."),
            emptyPara(),

            heading2("Scenario Library"),
            para("The system will include a library of conversation scenarios, organized by category:"),
            bullet("Social: greetings, small talk, catching up with a friend, meeting someone new"),
            bullet("Practical: ordering food, making a phone call, asking for directions, shopping"),
            bullet("Professional: job interview, meeting with a supervisor, presenting an idea"),
            bullet("Medical: describing symptoms, discussing treatment options, asking questions at a doctor visit"),
            bullet("Personal: expressing feelings, discussing a problem, sharing good news"),
            para("Users and caregivers can add custom scenarios. The scenario library is stored locally as part of the user’s data."),
            emptyPara(),

            // ===== 9. PHASE 1 IMPLEMENTATION =====
            heading1("9.  Phase 1 Implementation (Completed)"),
            para("Phase 1 has been built and is functional as a proof of concept. The application is a static web app consisting of HTML, CSS, and JavaScript modules, with no build step and no backend server. It can be served from any static hosting platform (GitHub Pages, a local file server, etc.) and runs entirely in the browser."),
            emptyPara(),

            heading2("Application Structure"),
            para("The application is organized into the following modules, each in a separate JavaScript file:"),
            emptyPara(),

            bulletBold("app.js — ", "Application controller. Initializes all modules, manages conversation history (an in-memory array of partner/user turns), orchestrates the listen → checkpoint → generate → select → speak loop, and handles the settings dialog. A generation token discards any in-flight option request that a newer silence checkpoint has superseded, so the displayed options never revert to a less complete set."),
            bulletBold("stt.js — ", "Speech-to-text module using the browser’s Web Speech API (webkitSpeechRecognition / SpeechRecognition). Supports interim and final transcripts and accumulates speech across the whole listening session. A pause of the configured silence period fires a checkpoint with the speech collected so far rather than ending recording; the module keeps capturing, auto-restarting continuous recognition that the browser stops on its own during long pauses. Provides start/stop control, a reset for discarding the current exchange, and status callbacks."),
            bulletBold("llm.js — ", "LLM integration module. Sends conversation history to the Claude API (currently claude-sonnet-4-6) with a system prompt instructing it to generate exactly 3 response options as a JSON array. Uses the anthropic-dangerous-direct-browser-access header for browser-to-API calls. Supports configurable API key."),
            bulletBold("tts.js — ", "Text-to-speech module using the browser’s SpeechSynthesis API. Supports voice selection (user picks from available system voices in Settings). Provides speak, cancel, and voice enumeration functions."),
            bulletBold("placeholders.js — ", "Filler utterance module. Loads a customizable set of natural filler phrases from a JSON file (e.g., “Just a second…”, “Hmm, let me think…”). A filler is spoken at each silence checkpoint to hold the conversational floor while options are generated, then continues at a configurable subsequent interval until the user selects a response. Prevents repeating the same filler consecutively."),
            bulletBold("storage.js — ", "Local data persistence. Uses localStorage for settings (API key, voice preference, placeholder timing). Uses IndexedDB to persist the File System Access API directory handle across browser sessions. Provides file read/write functions for the user’s designated data folder."),
            bulletBold("ui.js — ", "User interface module. Manages transcript display (with interim/final styling), response option buttons, status bar, and listen button state. Response options are rendered as large, tappable buttons."),
            emptyPara(),

            heading2("User Interface"),
            para("The UI consists of:"),
            bullet("A header with the application title and a Settings button."),
            bullet("A start overlay that requires a user tap before the app begins (required by browsers for microphone and audio permissions)."),
            bullet("A transcript section showing what the communication partner said, with interim text shown at reduced opacity and final text at full opacity."),
            bullet("A response options section displaying the AI-generated options as large, tappable buttons."),
            bullet("A persistent “Please repeat what you said.” control, always visible below the generated options, that asks the partner to restate and discards the current capture (see Continuous Partner Capture below)."),
            bullet("A status bar showing the current system state (Ready, Listening, Generating, Speaking, errors)."),
            emptyPara(),

            heading2("Settings"),
            para("The settings dialog provides a tabbed interface with three tabs:"),
            bulletBold("General: ", "Claude API key entry, voice selection (with a test button), the Optional Responses silence period (how long the partner can pause before the speech collected so far is sent for options — see the Conversation Flow below), an auto-resume-listening toggle (default off; when on, partner recording turns back on automatically after a response is spoken), and data folder selection via the File System Access API."),
            bulletBold("Placeholders: ", "Configurable initial delay (2–6 seconds, default 4) and subsequent delay (6–15 seconds, default 10) for filler utterances."),
            bulletBold("About: ", "Application version, description, license (MIT), and link to Volksswitch.org."),
            emptyPara(),

            heading2("Conversation Flow"),
            para("The implemented conversation flow is:"),
            numberedItem("User taps “Start Listening.” The browser requests microphone access."),
            numberedItem("The communication partner speaks. Interim transcripts appear in real time."),
            numberedItem("The partner pauses for the configured Optional Responses silence period. The speech collected so far is sent to the Claude API with the conversation history; a filler utterance (“Just a second…”) is spoken to hold the floor. Recording continues."),
            numberedItem("Response options appear as buttons. If the partner resumes, the new speech is appended; the next silence period sends the combined speech for a fresh set of options and speaks another filler. This repeats for as long as the partner keeps talking."),
            numberedItem("The user taps a response at any time. Recording stops, filler utterances stop, and the selected response is spoken aloud via TTS."),
            numberedItem("The combined transcript is cleaned once and the exchange is committed to conversation history. The user taps “Start Listening” for the next exchange — or, if the auto-resume-listening setting is on, recording restarts automatically. Alternatively, the user taps the persistent “Please repeat what you said.” control, which discards the current capture and keeps listening for the partner’s restatement."),
            emptyPara(),

            heading2("Continuous Partner Capture"),
            para("Knowing when a person has finished speaking is genuinely hard, and it is hardest for the communication partner, who pauses mid-thought, resumes, and qualifies what they just said. Rather than treat a silence as the end of recording — which forces the system to guess whether the partner is done, cutting them off if it guesses early or delaying the user if it waits — Phase 1 treats the silence period as a checkpoint, not a stop."),
            para("At each pause of the Optional Responses silence period, the system sends the speech collected so far for response options and speaks a placeholder, but keeps recording. Resumed speech is appended, and the combined utterance is re-sent after the next pause, so each checkpoint yields a more complete set of options. Recording ends only when the user selects a response, at which point the exchange is committed; the transcript is cleaned a single time, after speaking, so cleanup never delays the user’s words and only sharpens the context carried into future turns. Two guarantees support the loop: a generation token ensures the latest checkpoint’s options always win over a slower earlier request, and a persistent “Please repeat what you said.” control lets the user discard a garbled capture and keep listening without storing anything. This is the pragmatic Phase 1 realization of the end-of-utterance problem framed in Section 11, which the three-way utterance classifier and filler ladder refine in later phases."),
            emptyPara(),

            heading2("Technical Notes"),
            bullet("The LLM system prompt instructs the model to return exactly 3 options as a JSON array of strings. The first option is the model’s best guess."),
            bullet("Conversation history is maintained as an in-memory array of {role, text} objects, sent to the API on each turn for context continuity."),
            bullet("The filler utterance set is loaded from app/data/placeholders.json and contains 30 natural conversational fillers. Users can customize this file."),
            bullet("The application uses ES modules (import/export) with no build step or bundler. It runs directly in any modern browser."),
            bullet("The API key is stored in localStorage (per-machine, instant access). The File System Access API directory handle is stored in IndexedDB (survives browser restarts but requires user re-approval)."),
            emptyPara(),

            // ===== 10. MODULAR ARCHITECTURE WITH DIAGRAMS =====
            new Paragraph({ children: [new PageBreak()] }),
            heading1("10.  Modular Architecture and Interface Design"),

            heading2("Border-Adjacency Principle"),
            para("The system’s modules are organized so that every module that exchanges data with another is placed adjacent to it in the layout — data flows only across shared borders. This is not merely a visual convention; it reflects a design commitment to clean, well-defined interfaces and minimal coupling. If two modules do not share a border, they do not exchange data directly."),
            para("This adjacency discipline has practical implications: it limits the blast radius of changes, makes the system easier to reason about, and ensures that introducing a new provider (e.g., swapping the STT engine) affects only the modules that share a border with it."),
            emptyPara(),

            heading2("Phase 1 Module Layout"),
            para("The Phase 1 layout is a 5-column, 3-row tiled grid. The main conversation pipeline runs left to right across the top row: Communication Partner → STT → Response Generation → Response Option UI → AAC User. Supporting modules tile directly below their upstream dependencies. All 8 primary data flows cross shared borders with zero non-adjacent connections."),
            emptyPara(),

            // Phase 1 diagram image
            new Paragraph({
                spacing: { before: 0, after: 40 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Figure 1: Phase 1 — Core Conversation Loop", bold: true, italics: true, color: "1F4E79", size: 22 })]
            }),
            new Paragraph({
                spacing: { before: 0, after: 200 },
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({
                    type: "png",
                    data: phase1Img,
                    transformation: { width: 648, height: 370 },
                    altText: { title: "Phase 1 Architecture Diagram", description: "Phase 1 modular architecture showing the core conversation loop with STT, Response Generation, Response Option UI, TTS, and supporting modules in a tiled grid layout", name: "Phase 1 Diagram" }
                })]
            }),

            boldPara("Row 1 (Main Pipeline): ", "Communication Partner | STT (NLP In) | Response Generation (LLM) | Response Option UI | AAC User"),
            boldPara("Row 2 (Support): ", "(Partner spans) | Transcript Display | Conversation Starters | TTS (NLP Out) | Filler Utterances"),
            boldPara("Row 3 (Data): ", "Local Data (FSA, spanning 2 cols) | Session Conversation Log | Settings & Configuration (spanning 2 cols)"),
            para("Key adjacencies: STT shares a border with both its upstream source (Communication Partner) and its downstream consumers (Response Generation, Transcript Display). The Response Option UI shares borders with Response Generation above and TTS below, ensuring the selected response flows directly to speech output."),
            emptyPara(),

            heading2("Nth Phase Module Layout (Full Vision)"),
            para("The full-vision layout is a 5-column, 4-row tiled grid. It preserves the Phase 1 top-row pipeline and adds enhancement and data layers below. 14 of 15 data-flow connections cross shared borders; the single exception (STT to Transcript Display) touches at a corner — a simple one-way display feed."),
            emptyPara(),

            // Nth Phase diagram image
            new Paragraph({
                spacing: { before: 0, after: 40 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Figure 2: Nth Phase — Full Vision Architecture", bold: true, italics: true, color: "1F4E79", size: 22 })]
            }),
            new Paragraph({
                spacing: { before: 0, after: 200 },
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({
                    type: "png",
                    data: nthPhaseImg,
                    transformation: { width: 648, height: 430 },
                    altText: { title: "Nth Phase Architecture Diagram", description: "Full vision modular architecture showing all five components including Situational Awareness, Shaping and Tuning, RAG Vector Database, Worldview Profile, and Export/Import in a tiled grid layout", name: "Nth Phase Diagram" }
                })]
            }),

            boldPara("Row 1 (Main Pipeline): ", "Communication Partner | STT (NLP In) | Response Generation (LLM) | Response Option UI | AAC User"),
            boldPara("Row 2 (Enhancement): ", "Transcript Display | Situational Awareness | Shaping & Tuning | TTS (NLP Out) | Filler Utterances"),
            boldPara("Row 3 (Data Retrieval): ", "Partner Profiles (spanning 2 rows) | RAG Vector Database (spanning 2 cols) | Settings & Configuration (spanning 2 cols)"),
            boldPara("Row 4 (Persistent Data): ", "(Partner Profiles spans) | Worldview Profile | Conversation History | Offline Review & Feedback | Export / Import"),
            para("Key adjacencies in the full vision: Response Generation shares a border with Shaping & Tuning directly below it, so the shaped prompt flows across a single boundary. Situational Awareness shares borders with both STT above (for audio-based partner recognition) and Shaping & Tuning beside it (for injecting location, partner identity, and calendar context). The RAG Vector Database spans two columns and shares borders with Shaping & Tuning above, Partner Profiles to its left, and both Worldview Profile and Conversation History below — all the data stores it indexes are adjacent to it."),
            emptyPara(),

            heading2("Open Interfaces (Adapter Pattern)"),
            para("Five interfaces are designated as open plug-in points using an adapter pattern: the core system defines a contract (the shape of inputs and outputs), and each provider implements that contract. Swapping a provider requires only replacing the adapter — no changes propagate to modules on either side of the interface. This is the mechanism that enables multi-vendor support without architectural disruption."),
            boldPara("STT Interface: ", "Accepts any provider that delivers a text transcript (final and interim events) via a common event model. Phase 1 default: Browser Web Speech API. Future: Whisper, Deepgram, Azure Speech, Google Cloud STT, AssemblyAI."),
            boldPara("LLM Interface: ", "Accepts any provider that takes a prompt and conversation context and returns structured response options (compressed hint and expanded text). Phase 1 default: Claude API (Anthropic). Future: OpenAI GPT, Google Gemini, Mistral, local models via Ollama."),
            boldPara("TTS Interface: ", "Accepts any provider that converts text to audio output. Phase 1 default: Browser SpeechSynthesis API. Future: ElevenLabs, Azure Neural TTS, Google Cloud TTS, Amazon Polly, voice-banked or cloned voices."),
            boldPara("Situational Awareness Sensor Interfaces (Phase 2+): ", "Each sensor type (GPS, face recognition, voice recognition, calendar) is a separate plug-in behind a common context-provider interface. Providers can be added or swapped independently."),
            boldPara("Embedding Interface (Phase 3+): ", "The RAG vector database uses an embedding provider to index worldview data, conversation history, and partner profiles. Candidates: Transformers.js for fully local in-browser embeddings, or cloud APIs such as OpenAI Embeddings, Cohere Embed, or Voyage AI."),
            emptyPara(),

            heading2("Data Stores"),
            para("All user data resides on-device via the File System Access API. No user data is sent to any server other than the LLM API (and optionally cloud STT/TTS). The data stores are:"),
            boldPara("RAG Vector Database: ", "On-device vector store (Phase 3). Indexes worldview profile, conversation history, and partner relationship data as embeddings. Queried at response-generation time to inject only the most relevant context into the LLM prompt."),
            boldPara("Worldview Profile: ", "Structured questionnaire responses (~100 questions). Stored as JSON files. The profile grows entirely at the user’s pace; zero answers still yields a functional system."),
            boldPara("Conversation History: ", "Session logs of partner utterances, AI-generated options, user selections, and feedback ratings. Used for RAG retrieval and offline review."),
            boldPara("Partner Profiles: ", "Identity data (face and voice signatures), relationship type, per-partner conversation preferences, and interaction history."),
            boldPara("Settings and Configuration: ", "API keys (encrypted), selected provider for each interface, UI preferences, filler phrase set, number of response options, and display mode preferences."),
            emptyPara(),

            // ===== 11. CONVERSATION ENGINE DESIGN LAYER =====
            new Paragraph({ children: [new PageBreak()] }),
            heading1("11.  Conversation Engine: A Conversation-Analysis Design Layer"),
            para("The architecture described so far models a conversation as simple turn alternation: the partner speaks, the user responds, and placeholder utterances hold the user’s place while they choose. In June 2026 the project added a design layer that treats this model as incomplete. Drawing on Conversation Analysis (CA) — the empirical study of how real talk is structured — three companion design documents specify how a richer interactional model becomes software. This section and the two that follow summarize them: the Conversation Engine (programmatic flow), the User Interface (presentation layer), and the Configuration Model (user-owned settings)."),
            para("The motivating insight from CA is that the hard problem for an AAC user is not only producing words quickly, but participating in the structure of talk — taking initiative rather than only answering, signalling and resolving misunderstandings in either direction, holding the floor legibly, and opening and closing conversations gracefully. The Conversation Engine gives the user a typed palette of these structurally distinct moves, not three paraphrases of the same answer."),
            emptyPara(),

            heading2("Four Anchoring Decisions"),
            bulletBold("Access-method independence. ", "The engine knows nothing about touch, switch scanning, or eye gaze. It emits typed, prioritized moves; a separate Presentation Layer (Section 12) renders them for the user’s configured access method. This keeps the direct-select initial target clean while leaving the expansion path open."),
            bulletBold("System infers, user overrides. ", "The engine classifies the partner’s action and switches conversational mode automatically. A small set of persistent, never-moving controls lets the user correct a misjudgment instantly."),
            bulletBold("Backchannels deferred. ", "Continuer support (one-tap “uh-huh” / “really?” during the partner’s extended turns) is a later phase. The end-of-utterance classifier ships binary now but is specified three-way so continuers slot in without rework."),
            bulletBold("Single combined LLM call. ", "One request both classifies the partner’s action and generates the slot-typed options, with the classification emitted first as inspectable structured output. The LLM is stateless; the application injects all conversation state."),
            emptyPara(),

            heading2("Layered Architecture"),
            para("The design divides into three layers with strict one-way knowledge — each layer knows only about the one below it:"),
            simpleTable(
                ["Layer", "Responsibility", "Knows about"],
                [
                    ["Conversation Engine", "Sequence stack, action classification, mode inference, move-palette generation, timing / filler ladder", "CA structure only — never UI or access method"],
                    ["Presentation Layer", "Renders the palette for the configured access method; pages moves that don’t fit; orders scan patterns", "Move types, priorities, and the user’s access profile"],
                    ["I/O Services", "STT (with confidence), TTS, audio assets for fillers and tokens", "Audio only"]
                ],
                [2200, 4100, 3060]
            ),
            para("The key invariant lives in the engine, not the UI: move types have stable ordinal positions (preferred is always first, repair always last). A scanning user’s layout may surface fewer moves per page, but the relative order never changes. This gives users motor automaticity — the ability to select “Pardon?” without reading — the same property that makes core-word boards effective."),
            emptyPara(),

            heading2("Conversation State: the Sequence Stack"),
            para("Conversation is modeled not as alternating turns but as a stack of open sequences. A first pair part (FPP — a question, invitation, request, complaint, or assessment) opens a sequence and creates an obligation that stays open until a type-matching second pair part (SPP) closes it. Sequences nest: if the user initiates repair (“Pardon?”), that pushes a new sequence on top of the still-open one. When the repair sequence resolves, the original question is still owed an answer — and the engine knows it."),
            ...codeBlock([
                "ConversationState {",
                "  sequenceStack: [          // what is currently “owed”, innermost last",
                "    { action: QUESTION_WH,  openedBy: PARTNER,",
                "      utterance: “What did you think of the movie?”,",
                "      sttConfidence: 0.91 }",
                "  ]",
                "  register:  ORDINARY | INSTITUTIONAL(role)   // medical, interview, retail…",
                "  phase:     OPENING | BODY | PRE_CLOSING | CLOSING",
                "  lastUserUtterance: string                   // for repair of our own turn",
                "  lastPartnerUtterance: { text, confidence }",
                "}"
            ]),
            para("Why the stack pays for itself: after a clarification detour, current AAC systems strand the user with no path back to the original question. Here, when the repair sequence pops, the engine sees the original FPP still open and regenerates answer options against the now-clarified utterance — automatically. The moment most systems lose the user is handled structurally. The stack rarely exceeds depth two in practice, but modeling it as a stack rather than a single “pending utterance” variable is what makes nesting recoverable."),
            emptyPara(),

            heading2("The Four-Slot Move Palette"),
            para("At every transition-relevance place (TRP) — a point where it becomes relevant for the user to take a turn — the engine generates a palette of structurally distinct moves. This refines the earlier “3 response options” default: the palette is typed by move, not merely counted, and the option count remains configurable. The default RESPONDING-mode palette, illustrated after the partner asks “Want to come to dinner Friday?”:"),
            simpleTable(
                ["Slot", "Move type", "Example"],
                [
                    ["1", "Preferred SPP", "“I’d love to — what time?”"],
                    ["2", "Dispreferred SPP (hedge + account)", "“Ah, I wish I could, but I have PT on Friday.”"],
                    ["3", "Initiative (counter, return question, expansion)", "“Could we do Saturday instead?”"],
                    ["4", "Repair initiator (standing or confidence-triggered)", "“Sorry — dinner where?”"]
                ],
                [900, 3700, 4760]
            ),
            bulletBold("Slot 1 — Preferred. ", "Delivered plainly, no hedging, per CA preference organization. The model’s best guess at what this user would most plausibly say."),
            bulletBold("Slot 2 — Dispreferred. ", "Properly formed: a preface (“Well…”, “Ah…”), the declination or disagreement, and a brief account. A bare “No” is treated as a prompt-design defect, not a valid option."),
            bulletBold("Slot 3 — Initiative. ", "The structurally new slot. A counter-offer, return question, or topic expansion is how a speaker stops being purely responsive. Without it the AAC user is locked into the answerer role — the social asymmetry AAC users report disliking most. Slot 3 also varies grammatical format (conditional, declarative, interrogative), so the substantive options are genuinely different moves."),
            bulletBold("Slot 4 — Repair. ", "Always generated; surfaced with elevated priority when STT confidence is low or the partner’s utterance is long. Form adapts: open-class (“Sorry?”) when confidence is globally low, restricted (“Dinner where?”) when a specific span is uncertain."),
            para("Each move the engine emits carries: slot type, spoken text, compressed hint text, priority, and latency class (whether selecting it requires an LLM round-trip or plays immediately). The slot structure — typed, prioritized, positionally stable — is constant across modes; only the contents change."),
            emptyPara(),

            heading2("Five Modes, Inferred and Overridable"),
            para("The engine operates in one of five modes. The combined LLM call’s action classification selects the mode automatically; persistent controls let the user override it."),
            simpleTable(
                ["Mode", "Entered when", "Palette becomes"],
                [
                    ["LISTENING", "Partner is speaking; no TRP yet", "Idle; filler ladder armed"],
                    ["RESPONDING", "TRP detected; partner action is an FPP", "Default four-slot palette"],
                    ["REPAIR-OF-SELF", "Partner’s utterance classified as a repair initiator (“What?”)", "Operations on the user’s last utterance: re-speak verbatim (instant), rephrase (LLM), expand (LLM)"],
                    ["INITIATING", "User opens, or conversation is idle", "Pre-sequences and openers: “Hey, got a minute?”, “Guess what.”"],
                    ["PRE-CLOSING / CLOSING", "User presses Wind down, or partner produces a pre-closing (“Okay, well…”)", "Pre-closings, then terminal exchanges (“Bye!”, “Great seeing you”)"]
                ],
                [2000, 3700, 3660]
            ),
            boldPara("Persistent override controls. ", "Four always-present, never-moving buttons form the user’s escape hatch when inference is wrong — and all are zero- or low-latency, because override moments are exactly when the system has already misjudged once. Say again re-speaks the user’s last utterance verbatim (no LLM). Hold on fires a floor-holding filler. Pardon? manually initiates repair on the partner’s turn. Wind down enters PRE-CLOSING mode."),
            boldPara("Pre-sequences as composition time. ", "A pre-sequence such as “Hey, got a minute?” is short, formulaic, and cheap to produce — and it obligates a response (“Sure, what’s up?”), which buys the user a socially ratified pause in which to compose the expensive substantive turn. This is the filler trick executed at conversation scale: spend a cheap token to purchase composition time. INITIATING mode makes pre-sequences the first-class entry point."),
            emptyPara(),

            heading2("Timing: the Filler Ladder"),
            para("CA research sets two clocks that cannot both be satisfied serially. Silence at a TRP becomes perceptible at about 0.7 seconds and is read as meaningful (a rejection coming, a breakdown) past about 1 second. Meanwhile transcript confirmation must precede option generation, and generation itself takes up to ~3 seconds. The resolution is to make floor-holding an escalating ladder, where each rung needs less information than the next:"),
            simpleTable(
                ["When (after TRP)", "Rung", "Requires"],
                [
                    ["~0.5–1.0 s", "Acknowledgment token: “Hmm.” / “Good question.”", "TRP detection only. No LLM, no confirmed transcript. Kills the dangerous silence instantly."],
                    ["~2–3 s", "Projection filler: “Give me a second.” — or cheaply contextualized from the partial transcript", "Partial transcript at most. Covers the transcript-confirmation window. This is the existing placeholder mechanism, now with a defined job."],
                    ["Periodic re-fill", "“Still thinking…” — escalating variants, never repeated consecutively", "Timer only. Covers extended composition."]
                ],
                [1700, 3500, 4160]
            ),
            para("The reframe is important: the first rung is not merely a courtesy — it is the architectural component that makes transcript validation affordable. The acknowledgment token buys the time; validation spends it. Generation begins only after the user confirms (or corrects) the transcript. This replaces the Phase 1 fixed 4-second initial delay, which should drop to fire the first rung inside ~1 second. The same audio assets and trigger plumbing will later double as the continuer / backchannel mechanism."),
            emptyPara(),

            heading2("Repair Runs in Both Directions"),
            boldPara("User repairs the partner’s turn (other-initiated repair). ", "Covered by Slot 4 and the persistent Pardon? control. The engine selects an open-class initiator when overall STT confidence is low, a restricted initiator targeting the uncertain span when confidence is locally low, or a request for repetition when the utterance was long. Initiating repair pushes a nested sequence; on resolution, the engine regenerates the palette against the clarified original FPP."),
            boldPara("Partner repairs the user’s turn (the missing mirror case). ", "Equally common and currently unaddressed anywhere in AAC: the partner says “What was that?” — the TTS was unclear, or they weren’t listening. The engine must not generate fresh answers; it switches to REPAIR-OF-SELF mode and offers operations on the user’s last utterance: re-speak verbatim (one tap, zero latency), rephrase, or expand. This requires no new infrastructure beyond storing the last utterance and one classifier label — and it is identified as the single highest-leverage near-term item in the design."),
            emptyPara(),

            heading2("End-of-Utterance Classification: Specified Three-Way, Shipped Binary"),
            para("End-of-utterance detection is currently binary (done / not done). The full specification is three-way, so richer behavior slots in later without rework:"),
            bulletBold("COMPLETE (true TRP) — ", "grammatically, prosodically, and pragmatically complete. Generate the palette; start the filler ladder."),
            bulletBold("INCOMPLETE — ", "a mid-utterance pause. Do nothing; keep listening. Responding here is the high-stakes “false TRP” error that reads as rude."),
            bulletBold("CONTINUING (deferred) — ", "the partner is mid-telling, paused at a clause boundary. The right move is a continuer (“uh-huh”, “really?”), not a full response. Reserved in the classifier schema now; arrives as a new palette mode in a later phase. STT providers should therefore be evaluated on TRP accuracy, not just word accuracy."),
            emptyPara(),

            heading2("The LLM Contract: One Call, Inspectable Classification"),
            para("A single combined call both classifies and generates, with the classification emitted first in the structured output. Forcing the model to commit to the action type before producing moves implements the CA recommendation (identify the FPP type before generating SPPs) as a structural property of the output rather than a hope — and yields a logged classification that can be audited when options feel wrong."),
            ...codeBlock([
                "// Request context (assembled by the engine; the LLM stays stateless)",
                "{ “transcript”: “Want to come to dinner Friday?”, “stt_confidence”: 0.91,",
                "  “sequence_stack”: [ /* open sequences, innermost last */ ],",
                "  “register”: “ORDINARY”, “phase”: “BODY”,",
                "  “last_user_utterance”: “…”, “recent_turns”: [ /* rolling window */ ],",
                "  “user_profile”: { /* voice, interests, standing facts */ } }",
                "",
                "// Response schema (classification committed first, then moves)",
                "{ “partner_action”: “INVITATION”,    // FPP type",
                "  “turn_status”: “COMPLETE”,        // COMPLETE | INCOMPLETE | CONTINUING",
                "  “is_repair_initiator”: false,      // triggers REPAIR-OF-SELF mode",
                "  “moves”: [",
                "    { “slot”: “PREFERRED”,    “text”: “…”, “hint”: “…” },",
                "    { “slot”: “DISPREFERRED”, “text”: “…”, “hint”: “…”, “account”: true },",
                "    { “slot”: “INITIATIVE”,   “text”: “…”, “hint”: “…”, “format”: “counter-offer” },",
                "    { “slot”: “REPAIR”,       “text”: “…”, “hint”: “…”, “trigger”: “low_stt_confidence” } ] }"
            ]),
            para("The policy table — which moves are generated and how they are prioritized, indexed by action type, register, confidence, and phase — lives in the system prompt for Phase 1 and can migrate into engine code as patterns stabilize. Practice Mode scenarios (Section 8) set the register field explicitly, converting the scenario library from vocabulary domains into interactional norm sets."),
            emptyPara(),

            heading2("Phasing of the Conversation Engine"),
            bulletBold("Phase 1 refinements: ", "sequence stack and conversation state; the four-slot palette with positional stability; the combined-call schema with action-type-first output; REPAIR-OF-SELF mode plus Say again (highest leverage); persistent override controls; filler-ladder rung 1 (acknowledgment token within ~1 s, replacing the 4 s delay); the transcript confirm gate with distinct visual states; and PRE-CLOSING / CLOSING mode."),
            bulletBold("Phase 2: ", "LLM-contextualized projection fillers (rung 2); confidence-adaptive repair forms; institutional register norms via Situational Awareness; STT provider evaluation on TRP accuracy; pre-sequence-driven INITIATING mode."),
            bulletBold("Later: ", "CONTINUING classification and the continuer palette (backchannels); prosodic TRP cues; on-device classification if latency or cost demands it."),
            emptyPara(),

            // ===== 12. USER INTERFACE DESIGN =====
            new Paragraph({ children: [new PageBreak()] }),
            heading1("12.  User Interface Design"),
            para("The Conversation Engine specifies what the system offers the user at any moment: a typed, prioritized palette that changes with the inferred mode. The UI design specifies the presentation layer that carries that flexibility to the screen — the screen regions and their behavior, the visual anatomy of a move, how the UI reorganizes itself as modes change, and how one engine output renders across direct touch, switch scanning, and eye gaze without any change to conversation logic. The wireframes below illustrate structure and behavior, not final visual styling; colors, fonts, and dimensions are design tokens, expected to be themed and scaled per user."),
            emptyPara(),

            heading2("Design Principles"),
            bulletBold("Data-driven rendering. ", "The UI never hard-codes a layout for a situation; it renders whatever palette descriptor the engine emits. New modes and move types appear without UI code changes."),
            bulletBold("Positional stability. ", "Move types occupy fixed ordinal positions — preferred first, repair last, persistent controls never move — so users build motor automaticity."),
            bulletBold("Triple coding. ", "Every move type is identified three redundant ways: position, color, and text badge. No meaning is carried by color alone."),
            bulletBold("Selection is commitment. ", "Selecting a move speaks it immediately; the conversation cannot afford a second confirm step. The transcript-confirmation gate is the one deliberate exception, and it gates input, not output."),
            bulletBold("Latency transparency. ", "Anything selectable shows whether it acts instantly or requires a generation round-trip, so the user never taps into an unexpected wait."),
            bulletBold("Glanceability under time pressure. ", "The hint, not the full sentence, is the primary reading target; hints name the conversational action (“Saturday instead?”) so a move can be chosen in a single fixation."),
            bulletBold("Inference visible, override adjacent. ", "The inferred mode is always displayed, and the controls that override it are always one selection away in a fixed location."),
            emptyPara(),

            heading2("Screen Anatomy"),
            para("The screen divides into four regions. Their relative arrangement is configurable (the persistent bar can sit on the side for some access methods), but each region’s role and internal behavior is fixed."),
            ...figure("Figure 3: Screen anatomy in RESPONDING mode", uiFig1, 600, 375,
                "Screen anatomy: A transcript region, B move palette, C persistent controls, D composer access"),
            bulletBold("Region A — Transcript. ", "Displays what the partner just said, with STT confidence, and hosts the confirmation gate. A mode chip below it names the engine’s current inference, colored to match that mode’s dominant slot. The chip is informational, not a button — overriding happens in Region C, so an accidental glance-touch cannot flip modes."),
            bulletBold("Region B — Move palette. ", "Renders the engine’s moves as cards. The grid shape adapts to the access profile; the slot order never does. Low-confidence situations elevate the repair card’s priority visually (e.g., an alert border) but never re-shuffle the fixed order."),
            bulletBold("Region C — Persistent controls. ", "Say again / Hold on / Pardon? / Wind down — always present, always in the same order, in every mode, on every page, all instant. These are the overrides for exactly the moments when the user must not have to search the screen."),
            bulletBold("Region D — Composer access. ", "Entry to free composition (keyboard or the user’s existing AAC page set) for when no generated move fits. Selecting it automatically triggers floor-holding, since free composition is the slow path; the generated palette remains one selection away."),
            emptyPara(),

            heading2("The Move Card"),
            ...figure("Figure 4: Anatomy of a move card (INITIATIVE slot shown)", uiFig2, 620, 318,
                "Move card anatomy: hint, full utterance, slot badge, format tag, latency dot"),
            bullet("Hint — the large, glanceable element; names the action and format, never a truncation; never wraps past two lines."),
            bullet("Full utterance — exactly what TTS will say, in smaller text; can be hidden entirely for single-fixation operation."),
            bullet("Slot badge — PREFERRED / DISPREFERRED / INITIATIVE / REPAIR, colored per the design tokens; together with position, this is the triple coding."),
            bullet("Format tag — the grammatical format (counter-offer, conditional, question); optional, hideable once slot positions are automatic."),
            bullet("Latency dot — filled: selection speaks instantly; hollow: selection triggers a round-trip first (e.g., “Rephrase it”), during which the card shows progress in place and the filler ladder covers the wait."),
            para("Behavior: one selection speaks the utterance and pops or pushes the sequence stack accordingly. There is no confirm dialog. Mis-selection recovery is conversational, not modal — the persistent controls and the next palette carry corrections, because in conversation a retraction is itself a turn."),
            emptyPara(),

            heading2("Mode-Driven Dynamics"),
            para("When the engine changes mode, the palette’s contents change but its frame does not. The user should experience mode changes as “the cards changed,” never as “the screen changed.”"),
            ...figure("Figure 5: The same frame across three modes — cards swap; geometry, slot order, and persistent controls do not", uiFig3, 620, 290,
                "The same screen frame rendered across three conversational modes, with only card contents changing"),
            bullet("What changes: card contents, slot badges, the mode chip, and (in REPAIR-OF-SELF) a context card showing what the system last said on the user’s behalf."),
            bullet("What never changes: region geometry, slot ordering, persistent controls, composer access."),
            bullet("Transition: a brief (~200 ms) crossfade of card contents, mode chip first. Motion is informative (something changed) but never relocating (nothing moved)."),
            bullet("Update queuing: a mode change or regeneration arriving mid-selection — mid-scan, mid-dwell, finger down — queues and applies only at a safe boundary. An option the user is in the act of choosing must never change under them. Persistent controls outrank everything and act immediately even with an update queued."),
            emptyPara(),

            heading2("Transcript Validation States"),
            para("The transcript region is a three-state machine, and the states must be visually unmistakable because they gate generation: options are never generated from an unconfirmed transcript (this remains a configurable default — see Section 13)."),
            ...figure("Figure 6: The three transcript states — color, label, and available actions change together", uiFig4, 600, 285,
                "The three transcript validation states: unconfirmed amber, confirmed-generating blue, options-ready green"),
            bulletBold("UNCONFIRMED (amber): ", "the STT result has arrived; generation is gated. Confirm proceeds; Fix opens correction. A configurable auto-confirm timer (rendered as a draining border) can confirm automatically above a confidence threshold. Low-confidence spans are underlined."),
            bulletBold("CONFIRMED · GENERATING (blue): ", "the ~3-second generation window is running and the filler ladder is audible. The currently playing filler is shown as text (♪ “Hmm, let me think…”), so the user always knows what their own voice is doing — the system never speaks invisibly."),
            bulletBold("OPTIONS READY (green): ", "the palette is live; the transcript stays displayed for reference during selection. If the partner speaks again before confirmation, the new utterance replaces the unconfirmed transcript and the state restarts — treated as the partner extending their turn."),
            emptyPara(),

            heading2("Timing Feedback and the Filler Ladder"),
            para("The filler ladder runs on the engine’s clock, but the UI makes it legible: the user must always be able to see what has been said on their behalf and what will happen next."),
            ...figure("Figure 7: What the user sees and hears along the filler ladder", uiFig5, 620, 248,
                "Timeline of the filler ladder showing acknowledgment token, projection filler, and re-fill against the silence threshold"),
            bullet("Every automatic utterance is displayed as it plays (♪ icon + text). Nothing the system says on the user’s behalf is invisible."),
            bullet("A mute-next control appears while the ladder is armed: one selection suppresses the next automatic filler, for moments when the user knows a filler would be wrong."),
            bullet("Hold on (persistent) fires a filler on demand and resets the ladder timer — the manual rung."),
            bullet("Ladder parameters are profile settings: rung delays, token voice and style, and whether rung 1 is enabled at all (some users prefer silence over an automatic “Hmm”)."),
            emptyPara(),

            heading2("Access-Method Adaptation"),
            para("The engine emits one palette descriptor; access-specific renderers present it. The access profile is pure configuration — switching a user from touch to scanning changes no conversation logic, only the renderer."),
            ...figure("Figure 8: One palette descriptor, three renderers — direct touch, switch scanning, eye gaze", uiFig6, 620, 297,
                "A single palette descriptor rendered three ways for direct touch, switch scanning, and eye gaze"),
            bulletBold("Capacity declaration. ", "Each renderer declares how many items it can present per page (touch: a 2×2 grid plus bar; scanning: 3–4 list items; eye gaze: 4 large targets). It takes items in priority order and pages the remainder behind a “More” item."),
            bulletBold("Priority-based dropping, never type-based. ", "When space shrinks, the renderer drops the lowest-priority moves the engine marked droppable. The engine controls priority; the renderer never decides which move types matter."),
            bulletBold("Scan order = priority order. ", "For scanning users, the engine’s priorities directly determine scan sequence, so the likeliest selection costs the fewest switch activations."),
            bulletBold("Stability binds hardest here. ", "For scanning and dwell, the queuing rule is mandatory: a palette update mid-scan would invalidate the user’s count, so updates apply only at scan-cycle boundaries."),
            emptyPara(),

            heading2("The Palette Descriptor — Engine-to-UI Contract"),
            para("Everything dynamic in the UI is driven by one versioned data structure. The Presentation Layer is a pure function of (descriptor, access profile, transcript state) — the boundary that keeps the UI flexible, so any future mode or move type the engine learns to produce is rendered by the same code."),
            ...codeBlock([
                "{ “mode”: “RESPONDING”,                 // drives mode chip + dominant color",
                "  “transcript_state”: “OPTIONS_READY”,  // UNCONFIRMED | GENERATING | OPTIONS_READY",
                "  “transcript”: { “text”: “…”, “confidence”: 0.91, “uncertain_spans”: [[18,24]] },",
                "  “now_playing”: null,                  // filler text while ladder is audible",
                "  “moves”: [",
                "    { “slot”: “PREFERRED”, “hint”: “Love to — what time?”, “text”: “…”,",
                "      “latency”: “instant”, “priority”: 1, “droppable”: false },",
                "    { “slot”: “DISPREFERRED”, “hint”: “Wish I could… PT Friday”, “text”: “…”,",
                "      “latency”: “instant”, “priority”: 2, “droppable”: true },",
                "    { “slot”: “INITIATIVE”, “hint”: “Saturday instead?”, “format”: “counter-offer”,",
                "      “latency”: “instant”, “priority”: 3, “droppable”: true },",
                "    { “slot”: “REPAIR”, “hint”: “Dinner where?”, “text”: “…”,",
                "      “latency”: “instant”, “priority”: 4, “droppable”: false } ],",
                "  “persistent”: [ “SAY_AGAIN”, “HOLD_ON”, “PARDON”, “WIND_DOWN” ],",
                "  “update_policy”: “queue_until_selection_boundary” }"
            ]),
            para("Priorities are engine-assigned and contextual (repair may carry priority 1 when confidence is low). The droppable flag protects moves that must survive small renderers — preferred and repair are typically protected. The descriptor is versioned so renderer and engine can evolve independently."),
            emptyPara(),

            heading2("Visual Design Tokens"),
            para("Slot identity is triple-coded — position, color, and text badge — so meaning survives any theme change. The default token palette:"),
            simpleTable(
                ["Token", "Default", "Notes"],
                [
                    ["PREFERRED", "Green #2E7D32", "Pale tint fill; border and badge carry the hue. Never the only cue."],
                    ["DISPREFERRED", "Amber #B26A00", "Warm, not red — declining is a normal move, not an error."],
                    ["INITIATIVE", "Blue #1565C0", "Also used for the RESPONDING mode chip."],
                    ["REPAIR", "Purple #6A1B9A", "Also marks repair-related context cards."],
                    ["Persistent controls", "Slate #455A64", "Visually quiet; recognized by position, not salience."],
                    ["Hint type size", "≥ 2× body text", "Primary reading target; maximum two lines."],
                    ["Motion", "≤ 200 ms crossfade", "May inform, never relocate. Respects reduced-motion settings."],
                    ["Contrast", "WCAG AA minimum", "All text-on-fill combinations, including badge-on-color."]
                ],
                [2400, 2400, 4560]
            ),
            emptyPara(),

            // ===== 13. CONFIGURATION MODEL =====
            new Paragraph({ children: [new PageBreak()] }),
            heading1("13.  Configuration Model: User-Owned Settings"),
            para("This system serves a population of individuals with unique abilities, needs, and conversational styles. No fixed flow — however well grounded in Conversation Analysis — fits everyone. The design response is to treat nearly every behavioral decision in the two preceding sections as a user-owned, adjustable setting, and to build the machinery that makes adjusting them safe. Settings are hypotheses: the user experiments with a flow, lives with it in real conversations, and adjusts from experience."),
            para("Two consequences follow. First, the behavioral statements in the Conversation Engine and UI designs are defaults of a standard profile, not rules. Second, configurability becomes an architectural requirement, not a preferences afterthought: the engine and presentation layer both consume one declarative configuration profile, so that any behavior worth deciding is decidable by the user."),
            emptyPara(),

            heading2("What Stays Invariant: Capabilities, Not Behaviors"),
            para("If everything is configurable, what protects the user from configuring themselves into a broken flow? The invariants are guaranteed capabilities, not fixed behaviors. The system enforces that certain communication paths always exist; the user controls every detail of how they manifest. These constraints are checked at save time — invalid combinations are rejected with a plain-language explanation, never silently corrected."),
            simpleTable(
                ["Guaranteed capability (always reachable)", "What remains configurable about it"],
                [
                    ["A repair path — always able to signal non-understanding", "Standing slot, persistent button, both, or confidence-triggered; its wording and position"],
                    ["A floor-holding path — always able to buy time", "Automatic vs. manual fillers; rung delays; token wording and voice; off except the manual button"],
                    ["A closing path — always able to exit gracefully", "Persistent button vs. suggested mode; the pre-closing and terminal phrase sets"],
                    ["A free-composition path — never limited to generated options", "Keyboard, page set, or external AAC app; where the entry point sits"],
                    ["Visibility of system speech — nothing spoken invisibly", "How it is displayed; how long it lingers; whether a mute-next control is offered"],
                    ["Revertibility — any change can be undone", "Nothing. This one is absolute: experimentation is only safe if return is guaranteed."]
                ],
                [3600, 5760]
            ),
            para("For example, the configuration system will not allow the repair slot, the Pardon? button, and confidence-triggered repair to all be disabled at once. The user is told why: “at least one way to say ‘I didn’t understand’ must remain.”"),
            emptyPara(),

            heading2("Three Settings Tiers"),
            para("Settings are organized by when they can safely change, not by who is allowed to change them. All tiers are user-owned; the Setup tier may be supporter-assisted at first configuration, but nothing is ever locked away from the user."),
            simpleTable(
                ["Tier", "Changeable", "Examples"],
                [
                    ["Quick", "Mid-conversation, one selection, no menu", "Mute next filler; palette page size; font-scale nudge; switch active profile"],
                    ["Profile", "Between conversations, from the profile editor", "Filler-ladder timings; slots enabled; confirm steps; mode-inference level; persistent button set"],
                    ["Setup", "Rarely; often supporter-assisted at first configuration", "Access method and renderer; scan/dwell parameters; STT/LLM providers; TTS voices; scenario registers"]
                ],
                [1400, 3500, 4460]
            ),
            emptyPara(),

            heading2("Parameter Registry (Representative Settings)"),
            para("Every behavioral decision in the design becomes a setting whose default is the CA-derived value. A few representative entries — each with the experience that might lead a user to turn the knob:"),
            bulletBold("TRP silence threshold (default 1.5 s; range 0.5–3.0 s). ", "Shorter feels snappier but risks responding before the partner finishes; longer is safer with slow-paced partners."),
            bulletBold("Rung 1 acknowledgment token (on, 0.8 s; or off). ", "Some users find an automatic “Hmm” uncanny and prefer silence until they act; others want it even sooner. The token set is a user-editable, recorded-or-TTS list."),
            bulletBold("Transcript auto-confirm (default off). ", "Can auto-confirm above a confidence threshold (0.6–0.95) with a visible timer. Users who rarely see STT errors reclaim the confirm tap; users burned by a bad transcript keep the gate."),
            bulletBold("Slots enabled (default all four). ", "Any subset, subject to the repair-path constraint. A user who never declines may drop DISPREFERRED for a bigger grid; another may want two initiative options."),
            bulletBold("Options requested per turn (default 4; range 2–6). ", "More choice versus faster scanning and less reading."),
            bulletBold("Mode switching (default automatic with override). ", "Automatic / suggest (chip pulses, user accepts) / manual only. ‘Suggest’ is a good middle stage while learning what the engine does."),
            bulletBold("Utterance length & tone (default conversational, medium). ", "Terse to elaborated; formality; humor; the user’s own lexicon and standing phrases — the voice should be theirs."),
            bulletBold("Palette update policy (default queue until selection boundary). ", "Direct-select users with fast eyes may prefer instant updates; scanning users must queue."),
            emptyPara(),

            heading2("The Experimentation Loop"),
            para("Configurability without feedback is guesswork, so the system closes the loop: every adjustment is journaled, every conversation produces metrics, and reverting is always one action."),
            ...figure("Figure 9: The experimentation loop — settings are hypotheses; conversations are the test", uiFig7, 600, 285,
                "The experimentation loop cycling through named profiles, conversation, session review, and revert"),
            bulletBold("Named profiles. ", "A profile is a complete, named snapshot of every setting — “Coffee shop,” “With Mom,” “Doctor visits,” “Trying faster fillers.” Profiles can be bound to Practice Mode scenarios, so rehearsing a medical visit automatically uses the medical profile. Creating a profile copies the current one, so experiments always start from a known-good base."),
            bulletBold("Change journal. ", "Every setting change is recorded automatically — what changed, from what, to what, when. The journal is the user’s lab notebook: it answers “what was different last week when conversations felt better?” without requiring the user to remember."),
            bulletBold("Session review card. ", "After a conversation, an optional card summarizes what the metrics can see. Metrics are descriptive, local, and private by default — they inform the user’s own judgment, never score them."),
            bulletBold("Guided trials. ", "Pick one setting, let the system tag the next N conversations, then show the review cards beside the previous baseline. The system suggests trials from the data (“You corrected the transcript once in 30 conversations — try auto-confirm above 0.85?”) but never changes anything itself."),
            emptyPara(),

            heading2("The Configuration Profile (Schema Sketch)"),
            para("One declarative, versioned document drives both the engine and the presentation layer — the same data-driven principle as the palette descriptor. Profiles are exportable and shareable, so users and supporters can trade starting points. Validation runs at save time against the capability constraints above."),
            ...codeBlock([
                "{ “profile”: “Coffee shop”, “version”: 3, “based_on”: “Standard”,",
                "  “timing”: {",
                "    “trp_silence_s”: 1.5,",
                "    “rung1”: { “enabled”: true, “delay_s”: 0.8, “tokens”: [“Hmm.”, “Ah.”] },",
                "    “rung2”: { “delay_s”: 2.5, “style”: “static” },",
                "    “auto_confirm”: { “mode”: “threshold”, “min_confidence”: 0.85, “timer_s”: 2 },",
                "    “selection_confirm”: “off” },",
                "  “palette”: {",
                "    “slots”: [“PREFERRED”, “DISPREFERRED”, “INITIATIVE”, “REPAIR”],",
                "    “options_per_turn”: 4, “repair_mode”: “standing”,",
                "    “voice”: { “tone”: “warm, a little wry”, “length”: “short” } },",
                "  “modes”: { “switching”: “automatic”, “repair_of_self”: true,",
                "    “persistent”: [“SAY_AGAIN”, “HOLD_ON”, “PARDON”, “WIND_DOWN”] },",
                "  “presentation”: { “renderer”: “touch_grid_2x2”, “motion_ms”: 200,",
                "    “update_policy”: “queue” },",
                "  “journal”: true, “metrics”: true }"
            ]),
            para("Positional stability of slot types is retained as a strong default — it is the basis of motor automaticity — but even it is a profile property: a user who reorders their slots gets their order applied consistently everywhere, preserving the property that matters (consistency) while surrendering the one that doesn’t (the system’s choice of order)."),
            emptyPara(),

            // ===== 14. PHASE 2 DESIGN SCOPE =====
            new Paragraph({ children: [new PageBreak()] }),
            heading1("14.  Phase 2 Design Scope"),
            para("Phase 2 adds situational awareness and addresses several design questions deferred from Phase 1. The following items are planned for Phase 2 design and development:"),
            emptyPara(),

            heading2("Situational Awareness"),
            bullet("Location context via the Browser Geolocation API (GPS on tablets, Wi-Fi positioning otherwise)."),
            bullet("Communication partner recognition via face recognition (face-api.js, running entirely in-browser) and/or voice recognition (Azure Speaker Recognition)."),
            bullet("Calendar integration (Microsoft Graph API or Google Calendar API) to provide time-of-day and scheduled-event context."),
            bullet("Contextually suggested conversation starters that replace Phase 1’s static canned phrases with suggestions based on who the partner is, where the user is, and what’s on the calendar."),
            emptyPara(),

            heading2("Deferred Design Questions"),
            para("Several design questions were identified during Phase 1 and intentionally deferred. The June 2026 design layer (Sections 11–13) has since resolved the structural shape of most of them; what remains is implementation and empirical tuning, noted below."),
            emptyPara(),

            boldPara("Response option UI layout: ", "Largely resolved by the UI design (Section 12), which specifies the four-region layout — transcript, move palette, persistent controls, and composer access — with geometry that never reflows on mode change. The composer-access region is the integration point for traditional AAC vocabulary, and the relative arrangement of all four regions is user-configurable via the configuration profile (Section 13). The one open piece is the specific screen-space allocation between the AAC vocabulary and AI-facilitated regions, which still benefits from input by domain experts (SLPs, OTs, and AT specialists)."),
            boldPara("Worldview questionnaire content: ", "Still genuinely open: what specific questions to include in the ~100-question worldview profile, and how to structure chunked conversational sessions for collecting responses. The Conversation Engine’s register field and Practice Mode scenarios (Section 11) provide the mechanism for delivering these sessions; the content itself awaits domain-expert input."),
            boldPara("Placeholder utterance evolution: ", "Now framed by the filler ladder (Section 11). The static randomly-drawn fillers of Phase 1 become rung 2 of the ladder, while rung 1 is a sub-second acknowledgment token and the contextual, LLM-generated fillers become the configurable rung-2 option (Section 13). What remains is implementation and the token-cost evaluation of contextual fillers — a cost borne by the user under the bring-your-own-API-key model."),
            boldPara("TTS inflection: ", "Browser TTS still offers limited control (pitch, rate, volume on SpeechSynthesisUtterance), and natural-sounding filler delivery still matters. The configuration model (Section 13) now exposes token voice and style — and an optional distinct filler voice — as profile settings, so users can tune delivery. The near-term task is evaluating whether pitch/rate tweaks improve naturalness; voice banking and cloned voices (future) remain the path to full inflection control."),
            emptyPara(),

            // ===== 12. ADVANCED FUTURE CAPABILITY =====
            heading1("15.  Advanced Future Capability: Streaming Response Generation"),
            para("The long-term vision is for the system to begin generating and refining response options while the communication partner is still speaking. Using partial STT transcripts as they arrive in real time, the system would propose candidate responses and continuously narrow and refine them as the utterance becomes clearer. By the time the partner finishes speaking, the user’s options would already be on screen — eliminating virtually all post-utterance latency."),
            para("This capability represents a significant architectural and UX design challenge. It is named here so that design decisions in earlier phases do not inadvertently foreclose the option. It is not a target for Phase 1 or Phase 2."),
            emptyPara(),

            // ===== 13. CANDIDATE HARDWARE AND SOFTWARE =====
            new Paragraph({ children: [new PageBreak()] }),
            heading1("16.  Candidate Hardware and Software Assets"),
            para("This section identifies specific products, services, and libraries that are candidates for fulfilling the requirements of each functional module. All candidates are evaluated against the project’s sustainability model: no server infrastructure the project must pay for, user-funded AI, and all user data stored locally. Free and open-source software (FOSS) components are strongly preferred — they eliminate recurring costs, prevent vendor lock-in, and maximize user autonomy. The accompanying Architecture Diagrams HTML file includes detailed comparison tables with pricing information."),
            emptyPara(),

            heading2("Target Hardware"),
            para("The application requires a Windows tablet running Microsoft Edge or Google Chrome with File System Access API support."),
            boldPara("Microsoft Surface Pro (primary candidate): ", "Windows 11, full Chrome/Edge support, 13-inch touch display with pen input, built-in kickstand, front-facing camera (for future face recognition), and strong accessibility support."),
            boldPara("Microsoft Surface Go: ", "Smaller (10.5 inches), lighter, more portable. Lower processing power but adequate for a browser-based application."),
            boldPara("Other Windows Tablets: ", "Lenovo ThinkPad X series, Samsung Galaxy Book, and HP tablets are all viable alternatives. Any Windows tablet with a modern browser and adequate screen size will work."),
            boldPara("Mounting and Accessories: ", "RAM Mount and similar vendors provide standard AMPS-pattern mounting hardware for wheelchair-accessible tablet placement. External Bluetooth speakers are recommended for TTS output in noisy environments."),
            emptyPara(),

            heading2("Speech-to-Text Candidates (NLP In)"),
            boldPara("Browser Web Speech API [FREE] (Phase 1 default): ", "Built-in, free, zero setup. Works in Chrome and Edge. Good accuracy for English. Limitations: not all browsers support streaming partial transcripts; silence detection must be implemented separately."),
            boldPara("OpenAI Whisper [FREE/OSS locally]: ", "Available as a cloud API ($0.006/minute) or as an open-source model that can run locally. Excellent accuracy across many languages."),
            boldPara("Deepgram: ", "Cloud API at $0.0043/minute with real-time streaming via WebSocket. Built-in endpointing. Excellent latency. A strong candidate for Phase 2+."),
            boldPara("Azure Speech Services and Google Cloud STT: ", "Both offer real-time streaming, good accuracy, and wide language support. Pricing comparable ($0.006–$0.009 per 15 seconds for Google; approximately $1 per hour for Azure)."),
            boldPara("AssemblyAI: ", "Cloud API at $0.01/minute with real-time streaming, speaker diarization, and sentiment analysis. Diarization could distinguish the communication partner’s voice from background speakers."),
            emptyPara(),

            heading2("Response Generation Candidates (LLM)"),
            para("The architecture supports both local (on-device) and cloud-based LLMs. Users can start with a completely free option — either running an open-source model locally via Ollama, or using a cloud provider’s free tier. API keys are stored locally and never transmitted to any server other than the user’s chosen LLM provider."),
            boldPara("Ollama [FREE/OSS] (local models): ", "The zero-cost option. Runs open-source models entirely on the user’s device. No account, no API key, no data leaves the device. Requires capable hardware."),
            boldPara("Claude API — Anthropic (Phase 1 default): ", "Free tier available. Haiku for speed, Sonnet for quality. Excellent instruction following and structured output."),
            boldPara("OpenAI GPT-4o / GPT-4o-mini: ", "Strong alternative. Free tier available. GPT-4o-mini is fast and inexpensive on paid tiers."),
            boldPara("Google Gemini: ", "Competitive quality with a generous free tier. Long context window useful for conversation history."),
            boldPara("Mistral: ", "European provider with strong multilingual support. Good alternative for multilingual AAC use."),
            emptyPara(),

            heading2("Text-to-Speech Candidates (NLP Out)"),
            boldPara("Browser SpeechSynthesis API [FREE] (Phase 1 default): ", "Built-in, free, zero latency to start. Windows 11 provides decent neural voices. Adequate for proof of concept."),
            boldPara("ElevenLabs: ", "Exceptional voice quality with voice cloning from minimal audio samples. Low-latency streaming. Plans from $5/month. Strong voice banking candidate."),
            boldPara("Azure Neural TTS: ", "High-quality neural voices at $1 per million characters. Custom Neural Voice service for voice banking."),
            boldPara("Coqui TTS / XTTS [FREE/OSS]: ", "Open-source text-to-speech with voice cloning. Runs entirely on-device with no API costs. Quality approaching cloud services."),
            boldPara("Voice Banking Services: ", "ModelTalker [FREE/OSS] (developed at Nemours for AAC), Acapela my-own-voice, and VocaliD all provide voice banking — especially valuable for users who may lose the ability to speak."),
            emptyPara(),

            heading2("Situational Awareness Candidates (Phase 2+)"),
            boldPara("Location — Browser Geolocation API [FREE]: ", "Built-in, free, zero cost. GPS on tablets, Wi-Fi positioning otherwise."),
            boldPara("Face Recognition — face-api.js [FREE/OSS]: ", "In-browser face detection/recognition using TensorFlow.js. Free, open-source, runs locally. Privacy-preserving."),
            boldPara("Voice Recognition — Azure Speaker Recognition: ", "Cloud service that identifies a communication partner by voice print. Useful when camera cannot see the partner."),
            boldPara("Calendar — Microsoft Graph API or Google Calendar API: ", "Reads upcoming events for context. Microsoft Graph is a natural fit for the Surface platform."),
            boldPara("Indoor Location — Bluetooth Beacons: ", "Fine-grained indoor positioning. Requires beacon hardware at key locations."),
            emptyPara(),

            heading2("RAG and Embedding Candidates (Phase 3+)"),
            para("The RAG system requires an embedding model and a vector database, both working within the browser or local environment. The leading candidates for both are free and open-source."),
            boldPara("Embeddings — Transformers.js [FREE/OSS]: ", "Runs embedding models directly in the browser via ONNX runtime. Free, fully private, no API costs."),
            boldPara("Embeddings — Cloud APIs: ", "OpenAI Embeddings ($0.02 per million tokens), Cohere Embed (free tier), and Voyage AI (free tier, recommended by Anthropic for Claude-based RAG)."),
            boldPara("Vector Database — Vectra [FREE/OSS]: ", "Lightweight vector database designed for Node.js and browser. JSON-file backed — natural fit for FSA storage."),
            boldPara("Vector Database — LanceDB [FREE/OSS]: ", "Serverless, high-performance vector database with columnar storage. May require WebAssembly port for in-browser use."),
            emptyPara(),

            // ===== FOOTER =====
            new Paragraph({
                border: { top: { style: BorderStyle.SINGLE, size: 4, space: 8, color: "CCCCCC" } },
                spacing: { before: 480, after: 0 },
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "This document reflects design discussions and Phase 1 implementation through June 2026.", italics: true, color: "808080", size: 18 })]
            }),
        ]
    }]
});

Packer.toBuffer(doc).then(buffer => {
    fs.writeFileSync("AI-Driven AAC Architecture Overview.docx", buffer);
    console.log("Document generated successfully with embedded diagrams.");
});
