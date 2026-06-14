# AI-Driven AAC — Project Context for Claude

## About Ken (the user)
Ken Hackbarth is President and Founder of Volksswitch.org. He has a three-decade background as a systems engineer at AT&T Bell Laboratories. He is **not** a developer or AI/AAC researcher — he is a product manager and systems thinker. He defines requirements, makes feature decisions, and recruits beta testers. Claude Code is the developer.

Published author: "Revolutionizing Augmentative and Alternative Communication with Generative Artificial Intelligence," ATOB Volume 18, Spring 2024 (pp. 100–123). This paper is the foundational vision document for this project and is stored as `ATOB_V18_Hackbarth.pdf` in this folder.

---

## Project Vision
Build an AI-driven AAC system that gives non-speaking individuals access to **real-time conversation** — currently impossible with existing AAC devices. The core problem is not words-per-minute; it is the human aversion to awkward silence (~4 seconds). AAC users are locked into near-real-time or batch communication, which marginalizes them and restricts them to transactional rather than interactional communication.

**Mechanism:** Generative AI presents response options within seconds of a communication partner's utterance. The user selects one; the device speaks it. The system speaks *as* the user, not *for* them.

---

## Target User (Initial)
Literate, non-speaking individual with cerebral palsy (CP), 16+, using **direct select** (touch/pointer) as the access method. Vision is to expand to wider range of ages, literacy levels, and accessibility profiles over time.

---

## Architecture Components (from the paper)
1. **Situational Awareness** — GPS, face/voice recognition, calendar
2. **NLP In** — Speech-to-text
3. **Statement/Response Generation** — LLM (the linchpin)
4. **Statement/Response Shaping/Tuning** — worldview model, relationship modeling, conversation history
5. **NLP Out** — Text-to-speech

---

## Build Decisions (confirmed)

**Platform:** Static web app served from GitHub Pages (or similar). User points browser at a URL. App runs entirely in-browser. No backend server.

**Target hardware:** The File System Access API (FSA) is not supported on iOS or Android, and Apple does not make a tablet-class Mac. Therefore the device must be a Windows tablet running Microsoft Edge or Google Chrome. The Microsoft Surface is the primary candidate.

**Local data storage:** File System Access API — the app is granted permission to read/write a local folder on the user's machine. All worldview data, conversation history, and profile data stays on-device. No data sent to any server except the LLM API.

**Cross-device transfer:** Later feature — user manually exports a data package and moves it via iCloud, Google Drive, or OneDrive.

**AI vendor:** Claude API (Anthropic) first. Multi-vendor support added later. User creates their own Anthropic account and supplies their own API key. The Claude API is pay-as-you-go, billed per token — there is **no ongoing free tier for API access** (the free tier on the consumer claude.ai app does not apply to the developer API). The user pays only for the conversations they actually have. API key stored locally.

> **Vendor choice is a USER decision — do not architect around Anthropic only. (Ken, June 14 2026.)** Anthropic is the *first* implementation, not the *only* one. The design must keep the LLM provider swappable: which vendor (Anthropic, OpenAI, Google, a local model, …) and which model tier is ultimately the user's choice. **Architectural requirement going forward:** isolate all provider-specific concerns behind a provider-agnostic interface (a generation call that takes conversation + profile/system text and returns `{classification, options, missing_facts}`), so adding a vendor is a new adapter, not a rewrite. *Current Anthropic-specific touchpoints to abstract when we add the second vendor* (all in `app/js/llm.js`): the `api.anthropic.com/v1/messages` endpoint, the `x-api-key` / `anthropic-version` / `anthropic-dangerous-direct-browser-access` headers, the request body shape (`system` + `messages` with `user`/`assistant` roles), the model id string, and the `usage.input_tokens`/`output_tokens` response fields. Settings currently labels the field "Claude API Key" and the key validation assumes `sk-ant-…`; both become vendor-dependent. Pricing is per-vendor/per-model (`app/data/pricing.json` is currently single-rate). Keep this list current as the abstraction is built.

> **Future setting — quality-driven model tier (upgrade/downgrade). (Ken, June 14 2026.)** Add a user-facing control to move the model up or down a tier (e.g., within Anthropic: Haiku ↔ Sonnet ↔ Opus) based on the user's *perception of response-option quality* vs. cost. Today the model is hardcoded to `claude-sonnet-4-6` (chosen for the user-pays-per-token cost balance). This setting makes the intelligence ↔ cost tradeoff the user's call, surfaced in plain terms ("responses not good enough? try a stronger model — it costs more per conversation"). Pairs naturally with the multi-vendor abstraction above (tier is a per-vendor concept). Not built yet.

**Speech-to-text transcript validation:** Displaying the transcript of what the partner said is **critical** — not optional. The user must be able to confirm the system heard correctly before selecting a response.

**End-of-utterance detection (continuous partner capture):** A silence period (the "Optional Responses silence period" setting) is a *checkpoint, not a stop*. Each time the partner pauses for that period, the speech collected so far is sent to the AI for response options and a placeholder is spoken; recording continues. Resumed speech is appended and the combined utterance is re-sent after the next pause, so each checkpoint yields a more complete option set. Recording stops only when the user selects a response, at which point the transcript is cleaned once and the exchange is stored. A "latest-wins" generation token discards superseded in-flight requests, and a persistent "Please repeat what you said." control discards a garbled capture and keeps listening. An **auto-resume-listening** setting (Settings → General; default **off**) turns partner recording back on automatically after a response is spoken, so the user need not tap Start Listening between exchanges. (Implemented June 2026; see `Continuous-Partner-Capture.docx` and Architecture Overview §9. This is the Phase 1 realization of the COMPLETE/INCOMPLETE/CONTINUING classifier and filler ladder above.)

**Voice/TTS:** Browser built-in TTS acceptable for MVP. Voice banking (personalized/cloned voice) is a valuable future feature.

**Communication partner:** Needs nothing. Entirely unaware of system internals. AR glasses are a future hardware form factor.

---

## Response Option Display

Response options shown to the user may appear in **compressed form** — a few words representing a fuller thought — to speed up reading. The system may also read the compressed hint aloud. The **trigger for the auditory hint is a user preference**: options include auto-playback as each option is highlighted in sequence, or on first tap (before a double-tap confirms selection). Additional triggers may be supported based on user feedback.

The user normally hears the **fully expanded response only when it is spoken** after selection. Whether the expanded text is displayed or read before confirmation may become a configurable option based on user feedback.

Position 1 in the options list is the AI's best guess. There is no special visual treatment to distinguish it — the design goal is simply that the first option is the best option, with that accuracy improving over time.

---

## Worldview Model
- Minimum viable version: a carefully selected "getting to know you" questionnaire (~100 questions)
- Questions are completed entirely at the user's own pace; none are required
- The system provides meaningful functionality even with zero worldview questions answered
- Info gathering must be **chunked** — physically draining for CP users
- Many real-time exchanges need zero worldview context ("Hi, how are you?" needs no personalization)
- RAG will reduce token overhead as the profile grows over time
- Designing the specific questionnaire content is part of the work ahead

---

## Rollout Sequence

**Phase 1 — Core Conversation Loop (Proof of Concept)**
STT → display transcript → placeholder utterance auto-spoken → LLM generates response options → user selects → TTS speaks full response. No worldview shaping, no situational awareness.

Key Phase 1 features:
- **3 response options** by default (configurable)
- **Conversation context:** rolling window of the current session only
- **Placeholder/filler utterances** (e.g., "Just a second…", "Let me think about that") automatically generated and spoken while the user is selecting; customization supported
- **Conversation initiation:** via a set of canned conversation starters (pre-configured phrases the user can select to open a conversation); later refined by situational awareness in Phase 2
- **Compressed display / expanded speech** for response options (see above)
- **Identity / personalization — now the worldview profile (was the interim name + "About You" seed):** The June-2026 stopgap (Settings → General "Your Name" / "About You" fields injected into the prompt) has been **removed in worldview Build Step 4**. Personalization now comes entirely from the worldview questionnaire ("About Me"), injected via `worldview.buildBlock()`. The no-bracket safety rule still always applies (the prompt forbids `[Name]`/`[city]` and tells the model to phrase around any unknown detail), so the app degrades gracefully with an empty profile. See the **Worldview Questionnaire (June 2026)** section.
- **Offline review/feedback mode:** deferred — too complex even in rudimentary form
- **Response option UI layout:** requires a design discussion on how much of the screen is allocated to traditional AAC vocabulary vs. AI-facilitated response options; ultimately user-configurable

**Phase 2 — Situational Awareness**
Add location context (GPS), communication partner recognition (face/voice), and calendar integration. Canned conversation starters become contextually suggested based on location and partner identity.

**Phase 3 — Worldview Shaping and Tuning**
Integrate the worldview model. Responses shaped to reflect the individual user's personality and goals. RAG employed to manage profile size. Offline feedback/review mode introduced here.

---

## Advanced Future Capability: Streaming Response Generation
The long-term vision is for the system to begin generating and refining response options *while the communication partner is still speaking* — using partial STT transcripts as they arrive. Options would be continuously updated and narrowed as the utterance becomes clearer. This eliminates virtually all post-utterance latency. This capability requires significant design thought and is not targeted for Phase 1 or 2.

---

## Strategic Context
Prior attempts at AI-driven AAC have been shelved when funding ran out. Ken's architecture avoids this by:
- **No server infrastructure** the project must pay for
- **User-funded AI** — users bring their own API key, pay only for what they use

Ken has screenshots of and has presented live demos of a prior team's shelved product. The goal is to share this architecture with those developers as a more sustainable path forward.

**First deliverable:** A high-level architecture document suitable for sharing with those prior developers — not code.

---

## Conversation Analysis Design Layer (June 2026)

Ken collected Conversation Analysis (CA) literature and had it synthesized into `CA-Concepts-for-AAC-Architecture.docx` (on Ken's Desktop). Three design documents in this folder map those concepts to the system. **All project decisions are recorded here in CLAUDE.md** (Ken's preference — this folder syncs across machines; Claude's machine-local memory does not).

**Documents** (all Word, styled like Ken's papers — Arial, "Volksswitch.org | June 2026 | For internal use" footer; figures `ui-fig1..7.png` alongside, generated with Python/Pillow, regenerable on request):
1. `Conversation-Engine-Design.docx` — CA concepts → programmatic flow
2. `UI-Design.docx` — presentation layer and dynamic UI
3. `Configuration-Model.docx` — user-owned settings registry and experimentation loop

### Settled decisions — Conversation Engine

- **Sequence stack, not turn alternation**: conversation state is a stack of open sequences (adjacency pairs); repair sequences nest on top; the original obligation is restored automatically when they resolve.
- **Four-slot move palette**: PREFERRED / DISPREFERRED (hedge + account) / INITIATIVE / REPAIR — structurally distinct conversational moves, positionally stable for motor automaticity. (Refines the earlier "3 response options" default: the palette is typed by move, not just counted; option count remains configurable.)
- **Five modes**: LISTENING, RESPONDING, REPAIR-OF-SELF, INITIATING, PRE-CLOSING/CLOSING.
- **Access method independent of conversation logic**: engine emits a typed, prioritized palette descriptor; renderers (direct select now; scanning/eye gaze later) present it. Consistent with the direct-select initial target while keeping the expansion path clean.
- **System infers mode, user overrides** via persistent buttons (default set: Say again / Hold on / Pardon? / Wind down).
- **Single combined LLM call** classifies the partner's action (FPP type) AND generates options; classification is emitted first in structured output so it is inspectable. LLM stateless; app injects state.
- **Filler ladder** (refines the placeholder mechanism and the old 4 s initial delay): rung 1 acknowledgment token ≤1 s after end-of-utterance (no LLM — this is what makes transcript validation affordable), rung 2 projection filler ~2.5 s covering the confirm window, rung 3 periodic re-fill. CA: silence becomes meaningful past ~1 s.
- **Backchannels/continuers deferred**; end-of-utterance classification schema reserves COMPLETE | INCOMPLETE | CONTINUING so they slot in later without rework.
- **Highest-leverage near-term item**: REPAIR-OF-SELF mode — partner says "What?" → re-speak / rephrase / expand the user's last utterance.

### Settled decisions — UI

- Four screen regions: transcript (with mode chip), move palette, persistent controls, composer access. Geometry never reflows on mode change — "the cards changed," never "the screen changed."
- Move card anatomy: glanceable hint (primary reading target; names the action, not a truncation), full TTS text, slot badge, format tag, latency dot (filled = instant, hollow = generation round-trip).
- **Triple coding**: slot identity = position + color + text badge; never color alone. Defaults: green preferred, amber dispreferred, blue initiative, purple repair.
- Transcript is a three-state gate: amber UNCONFIRMED → blue CONFIRMED·GENERATING → green OPTIONS READY. Options are never generated from an unconfirmed transcript (default; auto-confirm above a confidence threshold is configurable).
- **Nothing is spoken on the user's behalf invisibly** — every filler/token is displayed as it plays.
- **Palette updates queue until a selection boundary**: options never change under a user mid-selection (mandatory for future scanning/dwell renderers).
- Engine→UI contract is a versioned palette-descriptor JSON with `priority` and `droppable` per move; renderers drop/page by priority, never by move type.

### Configurability philosophy (overarching)

- **As many decisions as possible are user-determined and configurable.** This population is made up of unique individuals; the user experiments with a flow and adjusts from experience. Behavioral statements in the design docs are *defaults of the standard profile*, not rules.
- **Invariants are guaranteed capabilities, not fixed behaviors**: a repair path, a floor-holding path, a closing path, free composition, visibility of system speech, and revertibility must always exist; how they manifest is configurable. Config validation enforces "at least one path" rules at save time, with explanation — never silent correction.
- Three settings tiers by *when* a change is safe — Quick (mid-conversation) / Profile (between conversations) / Setup (rare, may be supporter-assisted) — all user-owned; nothing locked away from the user.
- Experimentation loop: named profiles (bindable to Practice Mode scenarios), automatic change journal, session review metrics (descriptive, local, private — inform the user, never score them), guided trials, one-tap revert. Revertibility is the one absolute.

---

## Worldview Questionnaire (June 2026) — Build Steps 1–4 DONE; core build complete

The worldview model (Architecture Overview §6) has a concrete questionnaire design, a build-ready implementation plan, and **Build Steps 1–4 are implemented and verified** (June 14 2026). Remaining steps (5 expand content, 6 RAG-lite) are enhancements, not blockers — the core worldview feature is functional end-to-end.

**Keyboard / field tabbing — shipped (June 14 2026).** The "About Me" questionnaire supports physical-keyboard users. **Decisions (Ken):** (1) *every* control is a Tab stop (native order — inputs and option chips alike), not a reduced inputs-only order; (2) opening a module **autofocuses its first answerable field** (accepted that on a touch device this also auto-pops the OS keyboard). Two fixes in `app/js/worldview-ui.js`: a `focusFirstField()` call at the end of `renderModule` (and on the targeted card when arriving from a "suggested next" chip), and `setBackgroundInert()` which marks the app `<header>` + `<main>` `inert` while the overlay is open so Tab stays inside the form instead of leaking out to Settings / the conversation controls behind it (cleared on close). CACHE_VERSION → `aac-v0.2.5`. Verified in preview: first field focused on module open, header+main inert while open and cleared on Done, no focusable leak outside the form (the only out-of-form stop is the pre-Start `#startBtn`, which is hidden in normal flow), no console errors. *Note — Windows touch keyboard:* when the cursor enters a worldview `<input>` the Windows on-screen keyboard (TabTip) pops; this is the **OS**, not our code (FSA-era black-box behavior already documented in "In My Own Words") — Windows auto-shows it whenever an editable element gets focus in a touch context. Levers if unwanted later: `inputmode="none"` per field, or the Chromium `navigator.virtualKeyboard` API (neither can *summon* a keyboard on demand). This is a config decision (hardware-keyboard vs. touch-only users), not a defect.

**Storage fallback (where worldview data lives without/with a stale folder) — confirmed June 14 2026.** Source of truth is `worldview.json` in the granted FSA data folder; `localStorage` key `aac_worldview` is a write-through cache (`worldview.js` `load`/`save`, `storage.js` `readFile`/`writeFile`). **No folder granted:** answers persist *only* in `localStorage` (per-browser/per-machine — not in the portable file, lost if browser data is cleared; `writeFile` is a silent no-op without a `dirHandle`). **Folder moved/renamed since last session:** `restoreDataFolder()` re-acquires the handle from IndexedDB; if the OS can't resolve it the handle is **deleted** and the app silently falls back to the `localStorage` cache, writing new answers to cache only until the user re-picks a folder.

**Cache → disk promotion (built June 14 2026).** `worldview.syncToFolder()` closes the cache-only gap: the moment a data folder becomes available it promotes cache-only answers to the portable `worldview.json`. Called at the three points a folder becomes available — `app.js` `handleStart()` (start-up restore), the Settings "Choose Folder" handler (`pickDataFolder`), and `worldview-ui.open()`. Logic: no folder → `'noop'`; folder + no on-disk file → write the cache to disk (`'wrote'`); folder + existing file → the **newer of {disk, cache} by `updated` wins** (write-through to both stores + in-memory) so neither side's recent edits are clobbered (`'wrote'`/`'adopted'`). Timestamp-wins, not field-level merge — adequate for the real scenarios (the main case is "no disk file yet"); a future field-level merge / "reconnect your folder" prompt remains a possible refinement. *Verified in preview only for the no-folder `'noop'` guard + wiring (no throw, cache write-through intact); the actual on-disk promotion needs a user-granted folder (FSA gesture) to exercise — confirm on the test tablet.*

**Build Step 4 — shipped (interim Name/About You removed):** No migration was needed — there were no meaningful legacy `userName`/`userAbout` values to preserve (Ken's call). Removed the stopgap entirely: the two Settings inputs (`index.html`), their wiring (`app.js` `openSettings` + init), `storage.loadUserProfile`/`saveUserProfile`, `llm.setUserProfile` + the name/about branch of `buildProfileBlock`, and the orphaned `.setting-optional` CSS. The General tab now points users to **About Me**. The worldview profile (`buildBlock()`) is the sole personalization channel; the no-bracket safety rule remains. CACHE_VERSION → `aac-v0.2.4`. Verified in preview: Settings opens/saves with the fields gone, profile injection still carries the worldview block + no-bracket rule with no stale remnants, no console errors, no remaining references to the removed symbols.

**Build Step 3 — shipped:** the generation call now injects the worldview profile and harvests gaps.
- `app/js/llm.js`: added `setWorldviewBlock(text)`; `buildProfileBlock()` now layers worldview block → interim name/about ("Also: …") → the standing no-bracket rule. `generateResponses()` now requests a single structured JSON object `{classification:{fpp,about}, options[], missing_facts[]}` and returns `{options, classification, missingFacts}`; `parseGeneration()` parses robustly and still tolerates a legacy bare array. `max_tokens` 300 → 500. **Model unchanged (`claude-sonnet-4-6`)** — kept deliberately for the user-pays-per-token cost model; this was not a model migration.
- `app/js/app.js`: imports the worldview model; `initApp()` loads the registry + profile (cache at startup); `handleStart()` reloads the profile from the data folder once granted; `generateOptions()` calls `llm.setWorldviewBlock(worldview.buildBlock())` each turn (so edits take effect immediately), destructures `{options, missingFacts}`, and routes `missingFacts` → `worldview.recordGaps(...)`.
- `app/sw.js`: CACHE_VERSION → `aac-v0.2.3`.
- **Verified in preview** (fetch stubbed — no API key needed): structured output parses to classification + options + `missing_facts`; legacy bare-array tolerated; system prompt contains the worldview block + name + no-bracket rule; app boots with registry loaded and no console errors. *Not yet exercised against the live Claude API* — that needs Ken's key in the running app.
- **Guardrail honored:** interim Name/About You Settings fields untouched (removed in Step 4).

**Build Step 2 — shipped:** `app/js/worldview-ui.js` + an "About Me" header button + a full-screen `#worldviewScreen` (index.html / styles.css), precached in sw (CACHE_VERSION → `aac-v0.2.2`). Home shows an intro, gaps-driven **Suggested next**, a module list with answered/total progress bars, and **Restart** (confirm → `resetAll`). Tapping a module opens its fields as cards (the "chunk"). Card supports every field type — choice (single-select chips + in-my-own-words), multi-with-options (toggle chips + add-your-own), free multi (comma-separated), text/number, and repeat (sub-field rows + add/remove) — plus three visible states (✓ Answered / Prefer not to say / unanswered), edit-in-place, and **Undo** for declined. Each card carries the in-flow **🔊 Speak my answer** control (Build Step 2 design intent; opt-in, speaks the saved value in the selected voice). Verified in preview: all field types persist incrementally to `worldview.json`/cache; decline/undo; progress + suggested-next update; restart clears; Done closes. *Step-3 note:* `buildBlock()` returns '' until `loadRegistry()` has run on the worldview instance — Step 3 must call `worldview.loadRegistry()` + `load()` at app init so generation can inject the profile even before the user opens "About Me".

**Build Step 1 (recap) — shipped earlier (June 14 2026), committed:**
- `app/data/worldview-questions.json` — static registry. Scope per resolved decisions: **full Tier-A** (A1 About You, A2 Where You Are, A3 People, A4 Daily Life, A5 Contact) + **Tier-C starter** (C1 Favorites, C2 Passions). Each field: `key`, `q`, `type` (text/number/choice/multi/repeat), `options`, `fills` (placeholder synonyms), `sensitive`, `defaultPrivacy`. A5 fields are `defaultPrivacy: private`.
- `app/js/worldview.js` — model layer: `loadRegistry()`, `load()`/save (data-folder `worldview.json` write-through + localStorage cache), `getField`/`setField`/`declineField`/`resetField`/`resetAll`, three states (unanswered=key absent / answered / declined=sticky), `effectivePrivacy`/`setPrivacy`, gaps `recordGaps`/`listGaps`/`clearGaps`, `getModules` (progress), `suggestedNext` (gaps-first), and `buildBlock()` (compact profile text; labels from `fills[0]`; declined + private fields surface only as a phrase-around instruction, never with their values).
- `app/sw.js` — precache list updated (worldview.js + registry), CACHE_VERSION → `aac-v0.2.1`.
- **Verified in preview:** set/decline/reset/un-decline state transitions; cache round-trip; `buildBlock()` includes shareable facts and withholds private (phone) values while listing age+phone as phrase-around; gaps add/bump/drop-answered/clear; suggested-next ordering. *Caveat:* verification exercised the in-memory + localStorage-cache path; the on-disk FSA `worldview.json` write goes through the same `storage.writeFile` that conversation logging already uses, but confirming an actual on-disk file requires a user-granted data folder (FSA needs a user gesture).
- **Not touched:** the interim Name/About You Settings fields (they stay until Build Step 4), per guardrail.

**Remaining build order:** ~~1) data model~~ ✓ → ~~2) questionnaire UI~~ ✓ → ~~3) LLM integration~~ ✓ → ~~4) remove interim Name/About You~~ ✓ (no migration needed) → **5) expand Tier-B + rest of Tier-C content (enhancement)** → **6) RAG-lite (enhancement, not needed until cross-session memory lands)**.

**Build Step 2 design intent — "Speak my answer" control (Ken, June 14 2026).** The questionnaire UI must include an on-demand **"speak my answer"** control during worldview collection, rendered **in-flow and close at hand** next to each answer — explicitly **not** in the Settings panel. Speaking an answer is opt-in/on-demand, never the automatic behavior that selecting a conversation *response* has. Rationale (scenarios that make spoken answers useful during collection): supporter-assisted entry (speech is the user's channel to the human helping); auditory proofread of free-text / "in my own words" answers; voice-match calibration (esp. B8 "Your Voice, in Your Words" — judge "does this sound like me?"); and doing the "getting to know you" session as a real conversation with another person. An **auto-speak toggle** (for the supporter-assisted and conversation-as-collection scenarios) is a reasonable later addition, but the always-available per-answer control is the requirement.

**Origin:** The interim *Your Name / About You* fields in Settings (shipped June 2026 to stop the LLM emitting `[Name]` placeholders) are a stopgap. The worldview questionnaire replaces and generalizes them. Bracketed placeholders are the signal of which personal facts conversations demand; the design turns that signal into a self-populating profile.

**Documents produced (in this folder, styled like the other design docs):**
1. `Worldview-Questionnaire-Draft1.docx` — the question bank. Three tiers: **A** Concrete Core (identity, place, people, daily life, contact), **C** Interests/Passions/Preferences (the layer the frameworks miss — Ken's explicit add), **B** Abstract Characteristics (personality via Big Five, values via Schwartz Portrait format, humor, register/style, beliefs, how-you-treat-different-people, emotional landscape, voice-in-your-words). Grounded in Big Five, Schwartz basic human values, and the AAC Communication Passport / "All About Me" tradition.
2. `Worldview-Implementation-Plan.docx` — build-ready plan. Slots into the Architecture Overview as **§17** (or expands §6). Covers data model, files, the gaps-log mechanism, conversation integration, UI flow, migration, build order, verification, and decisions-to-confirm.

**Settled design decisions:**
- **Three tiers** A (concrete, fills placeholders) / C (interests) / B (abstract, shapes voice). Abstract questions organized by *conversational lever* (what they change in output), not psychological taxonomy. Values use Schwartz **Portrait** format ("here's a person — how like you?").
- **Three field states:** Unanswered (eligible to ask/resurface) / Answered / **Declined** (sticky — never ask again, always phrase around; un-declinable). Skip ≠ Decline. Every question optional; full value at zero answers; chunked sessions.
- **Gaps-log mechanism:** the no-bracket / phrase-around rule stays, so gaps can't be read off the output. Instead the single combined generation call returns structured `{classification, options, missing_facts}`; `missing_facts` (normalized field keys) feed a gaps log that drives the questionnaire's "suggested next." Regex-on-output is only a fallback. This is **progressive profiling** — the questionnaire fills itself from real conversations.
- **Storage:** user-owned → `worldview.json` in the FSA data folder (localStorage cache), plus static `app/data/worldview-questions.json` registry. Contact info (A5) and beliefs (B5) **private by default** (never volunteered; phrase-around).
- **Sequencing guardrail:** keep the Name/About You Settings fields live until the questionnaire UI ships, then migrate legacy `userName`/`userAbout` into `worldview.json` and remove them. Do NOT remove early — it would regress the live app.

**Build order (from the plan doc):** 1) data model + registry → 2) questionnaire UI → 3) LLM integration (structured `missing_facts`, profile block, gaps recording) → 4) migrate + remove Name/About You → 5) expand Tier-B/Tier-C content → 6) RAG-lite.

**Token budget / RAG timing (plan doc §6):** We are *not* close to needing a RAG database. The questionnaire profile is bounded (~1–3K tokens fully answered = 0.1–0.3% of Sonnet 4.6's 1M context; ~a penny per conversation with prompt caching). RAG is driven by *unbounded cross-session memory* (Phase 3), not the structured fields — rough trigger is an always-relevant slice exceeding ~10–20K tokens. `buildBlock()` ships as simple heuristic selection (always-include core + topical facts on-topic; many turns need none); progression is heuristic → client-side embeddings (IndexedDB) → server-side vector store, the last only if cross-session memory becomes a headline feature (awkward in a no-backend app).

**Decisions resolved (Ken, June 14 2026) — these scope Build Step 1:**
1. **First-cut Tier-A set: FULL.** Author all Concrete-Core fields from the question bank now (not a smaller starter). Plus a starter of Tier-C interests (per build order).
2. **Contact info (A5): STRICT phrase-around for now.** Stored but never volunteered or shared in output. *Note / TODO:* add a per-field "assistant may share if I pick it" sharing control in a later build.
3. **Chunk size: NO FIXED CHUNK.** No enforced per-session stopping point; user answers as many or as few as they like each sitting. (The "suggested next" from the gaps log still guides ordering.)
4. **Tier-B beliefs (B5): DEFERRED** to a later build.
5. **Symbol/picture answers + supporter-assisted mode: LATER.** Build Step 1 supports typed/selected text answers only.

Also decided this session: the **type-and-speak composer** ("In My Own Words", § "Free Composition + Virtual Keyboard") is built alongside Build Step 1 as the manual worldview test pathway. See that section.

**Next-session kickoff prompt:**
> We're continuing the AI-Driven AAC worldview questionnaire work. Read the "Worldview Questionnaire (June 2026)" section of CLAUDE.md and the two design docs in this folder: `Worldview-Questionnaire-Draft1.docx` (question bank) and `Worldview-Implementation-Plan.docx` (build-ready plan). Two phases this session.
>
> **Phase 1 — Resolve the open decisions first, with me.** Plan doc §11 lists five decisions to confirm before building: (1) size of the first-cut Tier-A set (full vs. smaller starter); (2) contact info (A5) — per-field "assistant may share if I pick it" toggle vs. strict phrase-around for now; (3) target chunk size (questions per session); (4) whether Tier-B beliefs (B5) ships in this build or waits; (5) symbol/picture answers + supporter-assisted mode now or later. Use AskUserQuestion, recommend a default for each, and record my answers in this CLAUDE.md section.
>
> **Phase 2 — Build Step 1: data model + question registry** (plan §2–3). Create `app/data/worldview-questions.json` — the static registry (modules → fields with key, question text, type, answer options, placeholder synonyms `fills`, `sensitive`, `defaultPrivacy`, follow-ups), authored from the question-bank doc, scoped to whatever first-cut set we agreed in Phase 1 (Tier-A core + a starter of Tier-C interests at minimum). Create `app/js/worldview.js` — load/save `worldview.json` to the FSA data folder (follow `storage.js` patterns) with a localStorage cache; get/set/decline/reset fields; the three field states (unanswered = key absent / answered / declined = sticky); gaps add/list/clear; and `buildBlock()` returning the compact profile text for LLM injection (simple heuristic selection, no vector store — plan §6).
>
> Guardrails: do NOT touch the interim Name/About You Settings fields (they stay until Build Step 4). Honor declined/private at buildBlock time (never volunteer; phrase around). Gaps come from structured `missing_facts` in the generation response, not regex (plan §4) — that wiring is Build Step 3; for now just build the gaps add/list/clear API. Verify in the preview that worldview.js round-trips `worldview.json` through the data folder (set/decline/reset, buildBlock output, gaps add/list) before stopping. No commit or deploy unless I ask.

---

## "In My Own Words" — Free Composition + Virtual Keyboard (June 2026) — decided, not yet built

Free composition is one of the **invariants** (Configuration Model): the user must always have a path to type/compose something the AI did not generate and have the app speak it in the selected voice. The UI's **composer-access region** (UI-Design.docx four-region layout) is where this lives. "In my own words" is the user-facing name for that path.

**Why this surfaced now:** to test the worldview Tier model (and any response shaping) by hand before the AI generation path exercises it, we need a manual way to compose an utterance and speak it. So the simple composer is no longer just a far-future nicety — it's the **test harness for worldview output** and is wanted alongside Build Step 1.

### Settled decisions

- **The keyboard is the easy part; voice + return-to-UI are essentially free.** Any keyboard (OS or in-app) just deposits text into a focused field in the page. The app then speaks it via the existing `tts.speak()` path (already uses the app-selected voice), and the app UI was never actually left. No integration risk on the "speak in the app's voice" / "return to the app" requirements regardless of keyboard choice.

- **OS / browser keyboard cannot be reliably summoned, and is a black box — so it is a *fallback*, not the foundation.** Technical reality on a Windows tablet (Edge/Chrome):
  - There is **no web API to programmatically launch the Windows touch keyboard.** It auto-appears only when an editable element (`input`/`textarea`/`contenteditable`) receives focus *and* the device is in a touch context. "Invoke from a button" therefore means "focus a text field and hope the OS pops the keyboard."
  - On a Surface with the type cover attached (laptop mode) it often won't auto-pop at all. Behavior varies by tablet mode, Windows version, and browser.
  - The Chromium **VirtualKeyboard API** (`navigator.virtualKeyboard.show()`) only manages an already-available keyboard's overlay; it still requires focus on an editable element. Not a reliable on-demand "open system keyboard" switch.
  - It gives **zero control** over layout, key size, spacing, prediction, or access method — exactly the things that matter for a CP user's motor accessibility.

- **The real path is an in-app virtual keyboard.** It is the only option that:
  1. **Honors access-method independence** (engine emits a palette descriptor; renderers present it — direct select now, scanning / eye-gaze later). An OS keyboard can't participate in the future scanning renderer; an in-app keyboard *is* just another renderer.
  2. **Unlocks AI-assisted composition** — type a few words → expand into a full sentence *in the user's voice* (worldview model); personalized word/phrase prediction. The OS keyboard can touch none of this.
  3. Keeps visual + behavioral consistency (key sizing, triple-coding, dark mode, latency dots).

### Build order (decided)

1. **Type-and-speak composer — DONE (June 14 2026).** Added an "In your own words:" region to `index.html` (textarea + Speak + Clear), `ui.js` helpers (`onSpeakClick`/`onClearComposerClick`/`getComposerText`/`clearComposer`), and `handleSpeakComposed()` in `app.js` → `tts.speak()` in the selected voice. MVP behavior: speaks the composed text, guards empty/whitespace input, returns status to Listening/Ready. Works with whatever keyboard the OS offers (and a hardware keyboard in dev). This is the MVP realization of the free-composition invariant. **Deferred sub-decision (still open):** whether a spoken composed utterance should also be pushed into conversation history like a selected response (currently it is not). A "use system keyboard" affordance was not added (and must never be depended on for summoning the OS keyboard).
2. **In-app virtual keyboard (later).** A real renderer: on-screen keys sized for direct select, integrated with the app's look and the future access-method renderers.

   **Keyboard-selection design — BUILT & verified (June 14 2026); awaiting Ken's usability review on the test tablet.** Shipped: `app/js/keyboard.js` (the shared on-screen keyboard — digit row + QWERTY + shift/caps, space, backspace, Enter, and `, . ' -`; keys act on `pointerdown` + `preventDefault` so the target field keeps focus and the caret never moves; inserts at the caret and dispatches `input`; Enter saves single-line fields / inserts newline in the composer textarea). Settings → General radio "Keyboard for typing" (`index.html`), wired in `app.js` `openSettings`/`saveSettings`; `storage.loadKeyboardMode`/`saveKeyboardMode` (default `physical`); CSS for the panel + radios; `keyboard.init()` + `setMode(loadKeyboardMode())` at app init; sw precache + CACHE_VERSION → `aac-v0.2.6`. A `MutationObserver` on `#worldviewContent` sets `inputmode="none"` on dynamically-built `.wv-text` cards so the Windows keyboard is suppressed before first focus. Verified in preview (synthetic `focusin`, since the harness window isn't system-focused): onscreen mode shows the keyboard + suppresses the OS keyboard and types into both the composer and worldview fields; physical mode never shows it and leaves `inputmode` empty; Settings radio round-trips; no console errors. *Build details below remain the authoritative description.*

   **Keyboard-selection design — original spec (Ken, June 14 2026).** Motivating problem: on a Surface, Windows shows *no* on-screen keyboard when the type cover is attached in laptop position, but auto-pops its own keyboard when the cover is folded back or detached. We want the app's keyboard in that second case. **Detection finding:** the browser exposes *no* reliable signal for physical-keyboard attachment or Surface type-cover posture — `navigator.devicePosture` only reports foldable-*screen* state (`folded`/`continuous`), the Keyboard API reports layout not attachment, and there is no `isKeyboardAttached`. The only *effective-posture* inferences are reactive (watch `visualViewport`/VirtualKeyboard `geometrychange` to see whether Windows pops its keyboard on focus) or one-way (a trusted hardware `keydown` proves a keyboard exists; silence proves nothing). **Ken's decision: do NOT auto-detect or fall back. A user-set Settings parameter decides, and it drives behavior until the user explicitly changes it** ("won't be an issue in practice"). Spec:
   - **Setting:** Settings → General, two radio buttons "Keyboard for typing": ① *My physical keyboard* (default) ② *On-screen keyboard (app's own)*. Stored in `aac_settings` as `keyboardMode: 'physical' | 'onscreen'` via new `storage.js` `loadKeyboardMode()`/`saveKeyboardMode()` (default `'physical'`).
   - **Behavior:** `physical` → app renders no keyboard, inputs keep normal `inputmode` (if the OS pops its keyboard when folded, that's the OS; the user owns that choice). `onscreen` → in-scope text fields get `inputmode="none"` (the reliable Edge/Chrome switch that suppresses the Windows keyboard) and focusing one shows the app's own virtual keyboard. Read at field-focus time so a Settings change takes effect on the next field without reload.
   - **Scope:** the "In your own words" composer + the "About Me" questionnaire inputs, built as one shared keyboard component. Settings' own fields (API key) stay on OS/physical for now (Setup-tier, rare, often supporter-entered).
   - **Dependency / phasing:** the parameter is the easy ~10%; the virtual-keyboard *renderer* is the bulk and is this build-order item #2. The two MUST ship together — a setting that suppresses the OS keyboard and then shows nothing is a regression. Build = (a) `storage.js` accessors, (b) Settings radio group + wiring + CACHE_VERSION bump, (c) the shared app keyboard component (accessible key sizing for CP motor needs, inserts into focused field, Speak/Enter consistent with composer, dark mode, future scanning-renderer compatible), (d) composer + worldview focus handlers that summon/dismiss it. *Not yet started — awaiting Ken's go-ahead to build.*
3. **AI-assisted composition (later, after worldview lands).** Few-words → full-sentence expansion in the user's voice; personalized prediction.

Open sub-questions deferred to build time: where the composer sits relative to the move palette (screen allocation — already an open UI question), and whether the type-and-speak composer should also push the spoken utterance into conversation history like a selected response.

## Auto-update on launch / Start (June 14 2026), v0.2.10

**Problem (Ken):** the app didn't pick up new deployments on launch or when Start was pressed — the old "Ctrl+Shift+R dance." Two causes: (a) the network-first worker's `fetch(request)` still hit the **browser HTTP cache** (GitHub Pages serves `Cache-Control: max-age=600`), so a launch within 10 min of a deploy got stale assets; (b) the registration never rolled a redeployed worker into the running page — a new `sw.js` installed but the page kept the version it launched with.

**Fix (three parts):**
1. **`sw.js` revalidates.** Runtime fetch is `fetch(new Request(request, { cache: 'no-cache' }))` (ETag revalidation — can't serve stale within the max-age window). Precache `addAll` uses `new Request(u, { cache: 'reload' })` so the precached shell is fresh too. (`self.skipWaiting()` on install + `clients.claim()` on activate were already there.)
2. **Auto-reload on new worker (`index.html`).** A `controllerchange` listener reloads the page once when a freshly-activated worker takes control. Guarded with `hadController` (skip the first-ever install, which has no prior controller) and a `reloading` flag (no loop). `reg.update()` is called on `load` to check for a new worker every launch.
3. **Update check on Start (`app.js` `handleStart`).** `navigator.serviceWorker.getRegistration().then(r => r && r.update())` — a cheap no-op when nothing's new; if a new worker is found it activates and the `controllerchange` handler reloads. Covers the "left open, redeploy, press Start" case.

APP_VERSION / CACHE_VERSION → `0.2.10`. **Verified in preview:** worker registers + activates + controls the page, version 0.2.10 in About, no console errors, **no reload loop** on localhost (controllerchange doesn't fire after the first claim when nothing's new). *The redeploy→auto-reload path itself can't be exercised in the preview (needs a real new deployment) — confirm on the test tablet that a fresh deploy now appears on relaunch without a hard refresh.*

## App virtual keyboard — refinements + open design questions (June 14 2026), v0.2.11

Built (Ken's list) on top of the shared keyboard component (`app/js/keyboard.js`, `styles.css`):

1. **Keys 25% taller** — `.kbd-key min-height` 3.2rem → **4rem** (64px verified). `body.kbd-open` field clearance bumped 19rem → 23rem.
2. **Numbers + special characters on a separate page.** Two layouts: `LETTER_ROWS` (QWERTY letters + ⇧ + ⌫ + a bottom row of `123` toggle, comma, space, period, ↵) and `SYMBOL_ROWS` (digits row, two rows of specials `@#$%&*()-+` / `!?'":;/=_~`, bottom row `ABC` toggle + space + ⌫ + ↵). A `page` state + a `'page'` action key flip between them; `renderRows()` rebuilds (pointerdown handler is delegated on the root so swapping inner rows is safe). **Comma, period, space, backspace stay on the letters page per Ken;** space/backspace/enter are *also* on the symbols page because editing is impossible without them (flag if Ken wants them stripped to a strict letters-only home).
3. **Shift = one-shot, double-tap = lock.** New state machine: `'off' | 'shift' | 'lock'`. Single tap toggles off↔shift; a **double tap within 300 ms** (`SHIFT_DOUBLE_TAP_MS`) engages caps **lock**. One-shot `'shift'` auto-reverts to `'off'` after one character (`consumeShift()`); `'lock'` persists until shift is tapped again. Visuals: `.kbd-shift-on` (lighter blue, one-shot) vs `.kbd-caps` (solid dark, locked).

**NOTE — Enter key & a formal close button (Ken, to discuss).** `enter()` currently does newline-in-textarea / save-in-single-line. Ken flagged that **Enter may need to behave differently per context**, and the keyboard **likely needs a formal "close/done" key** rather than relying on Enter or focus-out to dismiss it. TODO comment left in `keyboard.js enter()`. Not yet designed.

**OPEN QUESTION — keyboard layout for non-touch-typists (Ken raised; Claude's recommendation).** The target users are **not touch-typists, so QWERTY is the wrong default.** Reasonable alternatives:
- **Alphabetical (ABC) grid** — A–Z in order; easiest to *scan* for someone who doesn't know QWERTY muscle memory. Strong default candidate.
- **Frequency-ordered** (e.g. ETAOIN-style, most-common letters central/large) — fewer/shorter reaches for direct select, but a learning curve and less "scannable."
- **Matrix/grid layouts** generally (rectangular A–Z + space) — best fit for the **future scanning / eye-gaze renderers** (row/column scan maps naturally to a grid), consistent with the access-method-independence invariant.
- Letter **prediction/completion** is a later layer, not a base layout.
- **Recommendation:** yes, make **layout a Settings option** (consistent with the configurability philosophy — everything user-determined). Ship **Alphabetical** alongside QWERTY first; design layouts as pure data (the `LETTER_ROWS`/`SYMBOL_ROWS` arrays already are), so adding one is data, not code. *Awaiting Ken's decision on which layouts to ship and whether to build the setting now.*

**OPEN QUESTION — Windows keyboard vs. app keyboard when editing the Settings panel (Ken, to discuss).** Today Settings fields use the **OS/physical** keyboard (the app keyboard is scoped to the composer + worldview only). Need to decide whether Settings should switch to the app keyboard too. Trade-off to work through: the app keyboard gives consistent sizing/access-method support, but **switching away from the OS keyboard loses OS affordances — copy/paste being the prime example** (also autofill, spellcheck, dictation). Settings is Setup-tier and often supporter-entered (esp. the API key, where paste matters a lot), which argues for keeping the OS keyboard there. Unresolved.

**ISSUE — Settings panel size vs. the Windows keyboard (partly addressed v0.2.11).** Fixed: the panel is now a **constant size on every tab** — `#settingsDialog { height: min(30rem, calc(100vh - 3rem)) }` — so its size is no longer a function of how many options a tab has (General vs. Conversation); the content scrolls within. **Still open:** when the Windows on-screen keyboard is up while editing a Settings field, the **panel + keyboard can't both fit vertically** (the Conversation tab especially). Fully solving this depends on the keyboard-for-Settings decision above (and/or reacting to `visualViewport` to shrink/anchor the panel when the OS keyboard appears). Recorded, not yet solved.

APP_VERSION / CACHE_VERSION → `0.2.11`. **Verified in preview** (on-screen mode, composer focused): keys 64px tall; letters page has no digit row + a `123` toggle; symbols page shows digits + specials + `ABC`/space/⌫/↵; one-shot shift capitalizes one letter then reverts (`Ab`); double-tap engages caps lock (`CD` stays upper); single tap (after >300 ms) unlocks; page toggles both ways; no console errors.

## Settings Panel — usability pass (June 14 2026), v0.2.8

Six Settings-panel improvements shipped (Ken's list), modeled on the Keyguard Designer web app's settings panel (`keyguard-designer-web/app.html`, the second working directory):

1. **"Cancel" → "Close".** Footer button relabeled (`index.html`). Behavior unchanged — it dismisses without persisting; **Save** persists.
2. **Draggable modal.** Added a dark title-bar `#settingsHeader` ("Settings" + faint "drag to move" hint) as the drag handle. `initSettingsDrag()` in `app.js` (adapted from Keyguard's `mousedown` drag, but using **pointer events** + `setPointerCapture`): on first drag it converts the native `<dialog>`'s UA centering to pixel `left/top` with `margin:0`, then tracks the pointer clamped to the viewport. Stays modal — the backdrop still blocks the app behind it — but can be moved aside. Position persists for the session.
3. **Live-apply of UI/behavior settings while the modal is open.** Settings that change app behavior now take effect on `change`, not only on Save, so (with the panel dragged aside) the effect is visible/audible immediately — the pattern Keyguard uses. Wired in `openSettings()` via `.onchange`: voice (`tts.setVoice`), silence threshold (`stt.setSilenceThreshold`), keyboard mode (`keyboard.setMode`). Save persists to storage; Close keeps the live changes for the session. This is the **foundation for future UI-customization settings** Ken flagged as coming.
4. **Point-release version in About.** `APP_VERSION` constant in `app.js` (currently `0.2.8`) injected into `#aboutVersion`; About now reads "Version 0.2.8 — Phase 1 Proof of Concept". **Bump `APP_VERSION` alongside `sw.js` CACHE_VERSION every release** — crucial for beta-tester bug reports.
5. **Scrolling panel.** Dialog is a flex **column** (header + footer pinned via `flex-shrink:0`, `#settingsContent` scrolling via `flex:1; min-height:0` on `#settingsLayout`, `max-height:calc(100vh - 3rem)`). **Two gotchas (the v0.2.8→0.2.9 fix below):** (a) `display:flex` on a `<dialog>` **drops the UA's auto-centering** (computed margin → 0, pins top-left) — restored with `inset:0; margin:auto` on the base `dialog`. (b) Putting `display:flex` on the *base* `dialog` selector also **overrode the UA's `dialog:not([open]) { display:none }`** (author origin beats UA regardless of specificity), so the panel was CSS-visible at all times — it showed at startup *and* "Close" appeared to do nothing (the button handlers are wired in `openSettings()`, which never ran, and `.close()` is a no-op on a not-truly-open dialog). **Fix:** scope the flex layout to **`dialog[open]`** so a closed dialog stays `display:none`.
6. **General tab shortened (Ken's call: "add Speech + Conversation tabs").** Tabs are now **General** (API Key, About You pointer, Data Folder) / **Speech & Input** (Voice, Keyboard for typing) / **Conversation** (silence period, auto-resume, + the former Placeholders delays folded in) / **About**. The standalone Placeholders tab is gone. Tab-switching JS is generic (`data-tab`), so no handler changes were needed.

**Touch drag:** `#settingsHeader` has `touch-action: none` so the browser doesn't claim the touch gesture for scroll/pan (without it a touch drag moved the panel only a few mm).

CACHE_VERSION → `aac-v0.2.9`; APP_VERSION → `0.2.9`. **Verified in preview:** panel hidden at startup (`display:none`, not in DOM box); opens to `display:flex` via the button; **Close actually closes** (`open:false`, `display:none`); tabs distribute correctly; version 0.2.9 in About; drag moves precisely and clamps to viewport edges; centered on default open; long (Conversation) tab scrolls on a short viewport with footer pinned; no console errors. *Note:* drag + `touch-action` tested via synthetic PointerEvents (harness window isn't OS-focused and synthetic events bypass `touch-action`) — **confirm real touch drag on the test tablet.**

## Versioning

Format: **major.minor** (e.g., `0.1`, `0.2`). All pre-release versions use major `0`. The decision to increment to `1.0` or beyond is made jointly by Ken and Claude Code based on maturity and readiness.

**Release publishing is always public.** GitHub releases for this project are public by standing decision — Claude Code is authorized to push tags and publish releases publicly without pausing for confirmation. (Ken, June 2026.)

**Commit and push every completed step (current phase).** While Ken is the only person with access to the GitHub Pages deployment, Claude Code should **commit and push to `main` automatically as each step is completed** — no need to ask. This will change once beta testers are engaged: Ken will say so, and at that point we become more conservative about what is shared on GitHub Pages (commit locally, push deliberately). (Ken, June 14 2026.)

Phase-to-version mapping (update as releases are tagged):

| Version | Phase | Notes |
|---------|-------|-------|
| 0.1     | 1     | Core conversation loop proof of concept |
| 0.2     | 1     | Continuous partner capture; persistent "Please repeat" control; auto-resume-listening setting |
| 0.2.8   | 1     | Settings panel usability pass: Close label, draggable modal, live-apply settings, point-release version in About, scrolling panel, General tab split into Speech & Input + Conversation tabs |
| 0.2.9   | 1     | Fix v0.2.8 regression: dialog flex layout scoped to [open] so the panel no longer shows at startup and Close works; touch-action:none on the drag handle for full-distance touch drags |
| 0.2.10  | 1     | Auto-update on launch/Start: SW revalidates (no-cache) to beat the GitHub Pages HTTP cache; controllerchange auto-reload rolls in a redeployed worker; update check on Start |
| 0.2.11  | 1     | App keyboard: 25%-taller keys, numbers/specials moved to a separate page, one-shot shift with double-tap caps lock; Settings panel fixed to a constant size per tab |

---

## Open Questions (remaining)
- Response option UI layout: `UI-Design.docx` now specifies the four-region layout and move palette; remaining question is screen allocation between traditional AAC vocabulary and the AI-facilitated regions (composer-access region is the integration point; ultimately user-configurable per the Configuration Model)
- Worldview questionnaire: design complete and the five open decisions resolved (June 14 2026); **Build Steps 1–4 implemented and verified — core worldview feature complete** (data model + registry, questionnaire UI, LLM integration, interim Name/About You removed). See the **Worldview Questionnaire (June 2026)** section. Remaining steps (5 expand Tier-B/C content, 6 RAG-lite) are enhancements.
- Placeholder utterances: currently drawn randomly from a static JSON file (app/data/placeholders.json). Predictable fillers will become a joke to communication partners over time. LLM-generated contextual fillers would sound more natural and could acknowledge the topic, but must be evaluated against token cost impact. The architecture already supports user-funded API keys, so any added cost is borne by the user. *Design now specified:* the filler ladder in `Conversation-Engine-Design.docx` §6 (rung 1 static token ≤1 s, rung 2 static-or-contextual, rung 3 re-fill); contextual fillers are the rung-2 LLM option in the Configuration Model. Remaining work is implementation and the token-cost evaluation.
- TTS inflection: browser TTS has limited control (pitch, rate, volume on SpeechSynthesisUtterance). Natural-sounding placeholder delivery matters — monotone fillers will sound robotic. Voice banking / cloned voices (future) would give much better inflection control. Evaluate whether pitch/rate tweaks on fillers can improve naturalness in the near term.
