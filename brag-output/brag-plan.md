# Brag Plan: Pip AI Room

## What is this app?
A Chrome extension that puts Gemini, ChatGPT and Claude in one research room: Pip, a small pink mascot, appears in each chat and carries their messages, runs their tools and keeps one shared memory (the brain), with no server and no API keys.

## The angle
Deadpan startup launch. The problem is stated completely seriously: you already have three AI chatbots, and they have never spoken to each other. Pip AI Room is the fix. The joke is that the product genuinely is three chatbots taking turns in a research meeting, scoping, collecting, challenging and concluding, with a pink pixel mascot as the go-between. The video plays it like a Series A pitch for a group chat.

## Hook (first 2-3 seconds)
Plain dark-ink text on paper, typed out like a memo:
"You have three AI chatbots."
"They have never spoken."
Hard cut on the beat. Nothing else on screen.

## Key moments (the middle)
- **Pip arrives.** The real Pip sprite (ported voxel mascot) hops in beside the name "Pip AI Room" and the product's own line: "Gemini, ChatGPT and Claude, researching together."
- **Connect all three.** The three seat cards from the room page (Gemini · Scout, ChatGPT · Analyst, Claude · Reviewer) arrive one by one, each with its status dot going green as the cursor clicks "Connect all three". Then the mission is typed into the real mission box.
- **They actually talk.** The conversation feed: the five phase bars fill (Scope, Collect, Hypothesise, Challenge, Conclude), turn counter climbs, messages from the three chatbots stack up with @mention hand-offs, the Brain tab count ticks up.

## Outro / punchline
"No server. No API keys." (verbatim from the README) then the logo lockup: Pip, "Pip AI Room", "Three chatbots. One brain." Final beat: Pip waves.

## User flow worth showing
entry → key action → result:
1. Press **Connect all three**: the Gemini, ChatGPT and Claude seats go green.
2. Type the mission and press **Start the mission**.
3. Watch turn-by-turn conversation and the phase tracker move from Scope to Conclude.

## Tone
- Preset: yc-parody
- Creative direction: Series A launch for a group chat, delivered with a straight face
- Interpretation: structured, one claim per scene, hard cuts, sentence case, mono for data points, no winking, restrained audio.

## Format: landscape — 1920x1080
## Duration: 21.5s

## Visual identity (from the project: src/room/room.css, src/pip/engine.js)
- Background: #fffaf3 (paper), cards #fffdf9
- Accent: #e6a0ac (pink), deep #c9697a, pink ink #4a2a31
- Text: #2e2d2a (ink), soft #77716a, rule #e7ddd0
- Seat colours: Gemini #3d68d8, ChatGPT #23845a, Claude #bf5f31
- Display font: system serif (the room page's heading stack, rendered as generic `serif`)
- Body font: system sans; mono for kickers and data
- Strongest visual element: the room page itself (seat cards with 1.5px ink borders and 3px offset shadows) and Pip's pixel sprite

## Copy that must be grounded (verbatim from the project)
- "Gemini, ChatGPT and Claude, researching together."
- Roles: Scout, Analyst, Reviewer
- Buttons/labels: "Connect all three", "Start the mission", "Mission"
- Phases: Scope, Collect, Hypothesise, Challenge, Conclude
- Mission placeholder: "Why does south Kolkata waterlog after 50 mm of rain, and what would fix it fastest?"
- "No server, no API keys" (README)
- "@Claude check o3's source first" (the steer placeholder in Pip's own UI)
- Placeholder-level fiction (not claims): chat message bodies in the feed are illustrative UI text. They contain no numbers, stats or outcomes.

## Share copy (draft)
We built Pip AI Room to solve the fact that your three AI chatbots have never spoken. They scope, collect, challenge and conclude together, and you watch. No server, no API keys.

## Audio direction
- Role: warm bed with sparse professional accents
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120 BPM, light business groove), played low; first 22s
- Music treatment: start at 0, volume ~0.32 under SFX, fade out over the last 1.6s
- Music cue guidance: bundled preset read (`vol-1`, 120.19 BPM). Beat grid 3.02, 3.52, 4.02 ... every 0.5s. Strong cue 17.52 (outro reveal) and 16.02. Scene cuts land on beats: 3.52, 7.02, 13.01, 17.52.
- Audio-reactive treatment: subtle; music RMS/bass makes Pip's ground shadow and the pink accent glow breathe slightly. No waveform or equalizer visuals.
- SFX posture: sparse, motion-matched, low high-frequency risk only (click/impactSoft/bong). Seat cards get a soft click each, the outro gets one bell.
- Audio-coupled moments: typed hook (soft key ticks), three seat cards one by one, cursor click on "Connect all three", mission typing, feed messages arriving, final "No server." slam, logo bell.
- Restraint rule: nothing harsh, nothing repeated more than three times in a row, no sound under the readable pauses of the hook.

## Music cue guidance
- Track: vol-1, 120.19 BPM
- Strong cues for major moments: 7.02 (flow begins), 17.52 (outro reveal)
- Beat-grid windows for sequential reveals: 8.02–9.52 (three seat cards, every beat), 13.51–16.02 (feed messages, every other beat)
- Restraint: yc-parody is deadpan; sound supports, never jokes

## Storyboard

### Scene 1 — Hook — 3.5s (0.00–3.52)
Paper background, ink text typed out in sentence case, serif. Line 1 "You have three AI chatbots." types in at 0.2 (fully visible by 1.2), held. Line 2 "They have never spoken." appears at 1.7, held to the cut. Three tiny pill labels (Gemini, ChatGPT, Claude) sit far apart on the edges in their own colours, deliberately not connected.
Sequential/interaction: typing, character by character, two lines (settled hold ≥ 1.4s for line 2)
Audio intent: dry, almost silent room; music bed starts quietly
Audio-coupled idea: soft key ticks while typing
Transition mood: hard cut → Scene 2

### Scene 2 — Reveal — 3.5s (3.52–7.02)
Cut to Pip standing centre (the real Pip sprite, large) with the headline "Pip AI Room" in serif and, below, "Gemini, ChatGPT and Claude, researching together." Pip does the "hello" animation. The three pills from Scene 1 slide into a row under the line, now connected by thin ink lines.
Sequential/interaction: pills snap together one by one on beats 5.03, 5.53, 6.03
Audio intent: first musical statement; soft impact on the cut
Audio-coupled idea: beat-aligned pill snaps
Transition mood: hard cut → Scene 3

### Scene 3 — Connect and mission — 6.0s (7.02–13.01)
The room page, scaled up: header (Pip + "Pip AI Room"), then the three seat cards arriving one by one at 8.02, 8.52, 9.02, each "Open, not in the room" with an amber dot. A cursor moves to "Connect all three" and clicks at 9.8: all three dots go green, state "Ready". Then the mission box: the placeholder question types into the textarea (10.2–12.2) and the cursor presses "Start the mission" at 12.4.
Sequential/interaction: cards one by one; simulated cursor click; typed mission text (settled ≥ 0.8s before the cut)
Audio intent: tidy, productive
Audio-coupled idea: one click per card dot turning green, key ticks while typing, a click for the start button
Transition mood: hard cut → Scene 4

### Scene 4 — They talk — 4.5s (13.01–17.52)
Same room page, now live: the phase tracker (Scope · Collect · Hypothesise · Challenge · Conclude) fills left to right; "turn 1 of 12" climbs; messages arrive in the feed one by one: Gemini (Scout), ChatGPT (Analyst), Claude (Reviewer), each ending in an @mention of the next speaker. The seat card of the current speaker lights up in its colour. The Brain count in the header ticks up. All message text is short and number-free.
Sequential/interaction: three messages arrive one by one (each held ≥ 1.0s), phase bars fill in sequence
Audio intent: rhythm picks up gently
Audio-coupled idea: message arrival ticks aligned to beats 13.51, 14.52, 15.52; phase fill on every other beat
Transition mood: hard cut → Scene 5

### Scene 5 — Punchline — 4.0s (17.52–21.52)
Strong cue 17.52: hard cut to paper. "No server. No API keys." in large serif, one line at a time (17.6 and 18.5), settled ≥ 1.4s. At 20.0 (strong cue) the line dissolves to the lockup: Pip (waving) + "Pip AI Room" + "Three chatbots. One brain." held to the end. Music fades.
Sequential/interaction: two lines, then lockup
Audio intent: payoff, one bell on the lockup
Audio-coupled idea: bell at 20.02 on Pip's wave
Transition mood: hard cut at 17.52; a quick cut to lockup

**Music mood for this video:** upbeat, restrained (deadpan corporate)
**Audio summary:** a quiet dry open, the bed enters on the reveal, sparse clicks for each UI action, one bell to land the logo, a soft fade.
