# AI-Enabled AAC — Project Context for Claude

## About Ken (the user)
Ken Hackbarth is President and Founder of Volksswitch.org. He has a three-decade background as a systems engineer at AT&T Bell Laboratories. He is **not** a developer or AI/AAC researcher — he is a product manager and systems thinker. He defines requirements, makes feature decisions, and recruits beta testers. Claude Code is the developer.

Published author: "Revolutionizing Augmentative and Alternative Communication with Generative Artificial Intelligence," ATOB Volume 18, Spring 2024 (pp. 100–123). This paper is the foundational vision document for this project and is stored as `ATOB_V18_Hackbarth.pdf` in this folder.

---

## Project Vision
Build an AI-enabled AAC system that gives non-speaking individuals access to **real-time conversation** — currently impossible with existing AAC devices. The core problem is not words-per-minute; it is the human aversion to awkward silence (~4 seconds). AAC users are locked into near-real-time or batch communication, which marginalizes them and restricts them to transactional rather than interactional communication.

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

**AI vendor:** Claude API (Anthropic) first. Multi-vendor support added later. User creates their own Anthropic account; free tier supported, user upgrades as needed. API key stored locally.

**Speech-to-text transcript validation:** Displaying the transcript of what the partner said is **critical** — not optional. The user must be able to confirm the system heard correctly before selecting a response.

**End-of-utterance detection:** Goal is automatic silence detection. Manual trigger (user taps "done listening") is acceptable for MVP.

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
Prior attempts at AI-enabled AAC have been shelved when funding ran out. Ken's architecture avoids this by:
- **No server infrastructure** the project must pay for
- **User-funded AI** — users bring their own API key, pay only for what they use

Ken has screenshots of and has presented live demos of a prior team's shelved product. The goal is to share this architecture with those developers as a more sustainable path forward.

**First deliverable:** A high-level architecture document suitable for sharing with those prior developers — not code.

---

## Versioning

Format: **major.minor** (e.g., `0.1`, `0.2`). All pre-release versions use major `0`. The decision to increment to `1.0` or beyond is made jointly by Ken and Claude Code based on maturity and readiness.

Phase-to-version mapping (update as releases are tagged):

| Version | Phase | Notes |
|---------|-------|-------|
| 0.1     | 1     | Core conversation loop proof of concept |

---

## Open Questions (remaining)
- Response option UI layout: exact screen allocation between traditional AAC and AI-facilitated options (requires design discussion)
- Worldview questionnaire: what specific questions to include and how to structure chunked sessions
- Placeholder utterances: currently drawn randomly from a static JSON file (app/data/placeholders.json). Predictable fillers will become a joke to communication partners over time. LLM-generated contextual fillers would sound more natural and could acknowledge the topic, but must be evaluated against token cost impact. The architecture already supports user-funded API keys, so any added cost is borne by the user.
- TTS inflection: browser TTS has limited control (pitch, rate, volume on SpeechSynthesisUtterance). Natural-sounding placeholder delivery matters — monotone fillers will sound robotic. Voice banking / cloned voices (future) would give much better inflection control. Evaluate whether pitch/rate tweaks on fillers can improve naturalness in the near term.
