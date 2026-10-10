# This fork, against upstream

Base: **upstream v0.8.0** (rebased 2026-10-03). Branch: `feat/template-fields`,
28 commits plus this document.
Known-good tag: `callwatch-build-2026-10-03` — the v0.8.0-based build that
passed a real call. The v0.7.0-based history, its tag
`callwatch-build-2026-09-09` and the pre-rebase branch were deleted on
2026-10-09, and every commit from `3f49de8` onward was re-hashed that
day: a hash cited from before then may no longer exist.

Steno is the mechanism. The policy lives in a separate project directory
(`../Callwatch-Claude`): the template, the Obsidian CSS snippet, the tools, and
the design notes. Neither half reproduces a working setup alone.

---

## The one-line summary

A template can declare structured fields in its prompt; Steno extracts them in
a second model pass and writes them as YAML front matter on the report, which
then travels unchanged into an Obsidian vault as note properties. Plus
auto-record, and the bug fixes found along the way.

---

## Decided, not yet built

Every change against upstream will need its case made, so each is recorded
here before it is built: the problem, the evidence, what else was considered,
and who decided when. Once built, the record moves into its group below, with
the commits. The measurements are in `../Callwatch-Claude/CHANGES.md`; nothing
here is taken from real calls beyond counts.

Nothing is pending. The six changes decided on 2026-10-10 were built the same
day and are recorded in groups 3, 4, 6 and 11.

---

## The groups

Listed oldest first. The grouping is what matters for upstreaming — the branch
is linear, but it is not one change. Groups 8–10 (caller recognition, title
provenance, the note-header tooltips) are on `build/caller-id` only; the
numbers are the same in both branches' FORK.md.

### 1. Auto-record — LOCAL ONLY

    dc92eb5  Add opt-in auto-record for detected meetings       app/main.js

Starts recording when Steno's own meeting detector fires, instead of showing a
notification. Deliberately not for upstream: it is a behavioural preference,
and it is the single change in `app/main.js`, which upstream edits constantly.

It has not conflicted yet. Upstream's 0.8.0 rewrote large parts of `main.js`
(+635/−87) and left the detection block untouched: `handleMicEvent`,
`requestAutoRecord`, the notification path and the auto-stop timers are
byte-identical to 0.7.0. The setting is read straight from `config.json`, which
upstream's config layer loads and saves as a whole dict, so an unknown key
survives every save.

**That changes with the next rebase.** Upstream
[#566](https://github.com/stenolabs/stenoai/pull/566) (merged 2026-10-10, after
0.8.0) puts a guard at the top of `requestAutoRecord`: if a recording is
already running, it logs, calls `exposeMainWindow()` and returns. The guard is
aimed at the "Take Notes" tap. Upstream has no unattended auto-record, so its
"auto-record" means the start that tap triggers. Our signature,
`requestAutoRecord(appName, evt, calEvent, { focus })`, conflicts with it.
Resolve it as follows:

- Keep the guard, but call `exposeMainWindow()` only when `focus` is set. An
  unattended start that is turned away must not bring Steno to the front mid-call.
- The guard tests `currentRecordingSessionName` as well as
  `currentRecordingProcess || systemAudioRecordingActive`. That covers a
  capture flap, when `systemAudioRecordingActive` reads false briefly during a
  recording. The early "already recording" return in `handleMicEvent`, which
  both upstream and this fork have, tests only the first two. In a flap, our
  auto-record therefore goes past that check, and only #566's guard stops it
  from re-pointing `autoStartedSession` at the other app. Consider adding the
  session name to the early return too, so a flap never reaches
  `requestAutoRecord` at all.

#566 also tags "Meeting detected" toasts so that newer ones replace older ones.
Auto-record shows no toast, so the tags do not affect it.

### 2. Front matter correctness — UPSTREAM CANDIDATE, send first

    6f0d77b  parse with a real YAML loader in both readers
    d1d86c8  preserve keys the save paths do not own
    c80b9c8  parse front matter with a real YAML loader here too
    67ac565  let a duplicated key take its last value

Three hand-rolled front matter parsers existed, in `app/main.js`,
`src/report_store.py` and `app/obsidian-sync.js`. Each mangled a different real
value: a colon inside a title, a list item that read as a key. All three now
use a real loader (js-yaml / PyYAML), and the save paths no longer drop keys
they do not own.

`67ac565` followed on 2026-10-09. js-yaml throws on a duplicated key, where
PyYAML and every line-based parser keep the last value, and both js-yaml
readers caught the throw and carried on with no front matter: one repeated key
cost a note its title, folders and `is_diarised` on the detail page. Upstream's
own T2 test (`meeting-detail-flags`, "keeps a manually redacted diarised
summary transcript authoritative") seeds such a note and failed from `6f0d77b`
on. No real note had a repeated key. Fold it into `6f0d77b` and `c80b9c8` when
composing the submission; `frontmatter-duplicate-key.t2` checks list against
detail.

There was a fourth parser, and it is still line-based:
`simple_recorder._parse_meeting_markdown`, the list parser. It, not
`report_store`, is the Python mirror of `parseMeetingMarkdown` that upstream's
parity tests compare against. So list and detail parse front matter
differently: front matter that YAML rejects is empty on the detail page and
read in full in the list. Every note Steno writes is valid YAML (all 151 on
this machine, 2026-10-09), so only a hand-edited note can show it. A
submission should convert the list parser too, or say why not.

These are pure bug fixes with no dependency on the rest of the branch, which is
why they should go upstream first — every commit accepted upstream is one fewer
to carry through every future rebase.

Checked after a rebase: every `yaml.load` in `app/` passes `{ json: true }`
(`grep -n 'yaml.load(' app/*.js`). `frontmatter-duplicate-key.t2` covers the
two readers, not a new call site.

### 3. Obsidian export of the active report — UPSTREAM CANDIDATE

    3baea6e  export the active template report, not just the Standard note
    d97b72c  export a note's participants when a report replaces its body

The sync exported the Standard note even when a template report was the one on
screen. Independent of everything else here.

`d97b72c` (decided by Chris, 2026-10-10): the export read Participants from the
body it exports, which for a note with a template report is the report's, and
a template report has no Participants section. So no participant reached the
vault, a phone call's caller included, though Steno adds the caller to the
note's Participants (group 8, on `build/caller-id`). Seen on a note of
2026-10-10. Participants is the note's, so it is read from the note.

### 4. Configurable sampling temperature and per-request settings — UPSTREAM CANDIDATE

    476ba11  allow a configured sampling temperature
    9729711  give the data pass its own temperature setting
    837d7c9  per-request settings for cloud calls, by kind

Steno omitted the parameter entirely, taking each server's default — typically
around 0.7, which is high for a task that is mostly extraction. Now
configurable, and the two passes are configured separately (see group 6).

The setting works by adding `**self._cloud_kwargs()` to each OpenAI-compatible
call, so a call site upstream adds later silently lacks it. That happened in
0.8.0: query streaming moved into a new `stream_chat_prompt`, and the rebase
had to carry the kwargs there by hand. After any rebase, check every
`cloud_client.chat.completions.create` in `src/summarizer.py`, and that the
four call sites pass their kind: `summary` and `report` in
`summarize_transcript_streaming`, `title` in `generate_title`, `data` in
`complete_json`.

**Per-request settings** (`837d7c9`, decided by Chris, 2026-10-10).
`cloud_requests` in config.json gives the Standard summary, the title, a
template's prose pass and its data pass (`summary`, `title`, `report`,
`data`) each a `timeout`, `retries` and `extra_body`, the last passed to the
server unchanged. A kind left out sends exactly what it always did; chat and
transcript queries take none.

- *Problem:* behind an OpenAI-compatible server, a reasoning model thinks
  before every answer, and Steno could change neither that nor the title's
  hard-coded 30 s timeout. With Qwen 3.6 35B on Osaurus the title failed on 6
  of 8 calls measured. Each failure was 3 Steno attempts × 3 SDK attempts,
  nearly five minutes, and Osaurus keeps working on abandoned requests, so the
  template report then queued behind them.
- *Evidence:* `../Callwatch-Claude/CHANGES.md`, "Thinking, and what times out"
  (3 invented and 5 real calls, three thinking setups). Without thinking the
  title took 1–2 s, 8 of 8. Thinking helped the data pass (34 against 29 of 34
  fields on the invented calls, fewer done-or-discussed errors on real ones)
  and the prose pass, so it stays on there.
- *Considered:* turning thinking off for the title in code (the switch is
  spelled differently per server: Osaurus honours `enable_thinking: false` and
  `reasoning_effort: "none"` and ignored four other spellings); a yes/no
  `thinking` setting (it would do nothing, silently, on another server); only
  raising the timeout (keeps about 30 s of thinking per title, for a title the
  template replaces anyway).
- *Retries:* configuring them also turns off the SDK's own two, so the count
  is the whole count. A timed-out request is not cancelled on Osaurus, and
  each silent SDK retry queued another generation behind the one abandoned.
- *Output limit:* Steno sends no `max_tokens` on these four calls, so the
  server's default applies; Osaurus's is 16,384 tokens (measured 2026-10-10).
  With thinking, a 149-minute call's prose pass spent all of it reasoning once
  in three runs and returned an empty report. `extra_body` carries a higher
  limit; Osaurus honours one above its default (16,896 tested to the token)
  and accepted 65,536, which Chris's config now sets for `report` and `data`.
- *Upstream:* candidate together with the temperature commits. The case is any
  reasoning model behind an OpenAI-compatible endpoint.

### 5. Report front matter rendering — UPSTREAM CANDIDATE

    aa4d652  render a report's front matter as properties, not as prose

react-markdown has no concept of frontmatter. A report opening with it showed
the opening `---` as a horizontal rule; the closing `---` either underlined
every key above it into one large heading or, after a list, became a second
rule. (Corrected 2026-10-10: this record and the code comments used to say
both delimiters became rules and the keys one paragraph. Checked by rendering
both shapes through react-markdown.) Now split off and drawn as a compact
key/value list.

Worth upstreaming on its own merit rather than as part of the feature below: a
user-written markdown template can ask for YAML frontmatter in stock Steno
today, and it renders as garbage.

**Prepared as an upstream PR** on `feat/report-properties`, one commit on
upstream's main. The fork's group 5 files are kept identical to it
(`markdown.tsx`, its test, `ReportPropertiesDisclosure`, the T1 spec and its
`frontmatter` seed), so once it is merged the fork drops them at the next
rebase. Upstream spells it "frontmatter" (142 to 2), and its localStorage
keys are `steno-…`, hence `steno-report-properties-open`.

**Folded away by default** (decided by Chris, 2026-10-10). The always-open
table sat between the switch row and the report, and was the first thing on
every note from a template with fields. Now "Properties" and a count sit at
the right end of the My notes / template switch row, with a disclosure
triangle, shown only on a report that has front matter. Opened, the table
spans the width of that row and lists every property in the front matter's
order, except those the note's header already shows: `title`, joining `date`,
`duration` and `language`. Open or closed is remembered app-wide in
localStorage, not per note. The PDF shows the same properties; Obsidian is
unaffected.

A second level, "Details", for the title, inferred fields and Steno's own
keys, was built the same day and dropped: on a long call it saved little
space and read worse than one list. All or nothing.

`components/ReportPropertiesDisclosure.tsx` holds the toggle and the
remembered flag; T1 spec `report-properties`.

The strings now go through `t()`, which fixes the `npm run lint:i18n` failure
this group carried since it landed (`'yes'` and `'no'` were hardcoded in
`markdown.tsx`, where upstream's gate allows none). `docs/i18n/copy-inventory.json`
is regenerated with it.

When the gate reports an improvement in another file, lower that file's entry
in `renderer/i18n-lint-baseline.json` by hand: `npm run lint:i18n:update`
would also write new hardcoded strings into the baseline and hide them.

### 6. Declared fields — THE FEATURE, discuss before building a PR

    3f49de8  declared fields become YAML front matter on the report
    c48202c  allow a declared 'title' field, reserve the derived keys
    78b9be8  extract declared fields on every report path
    c3dd2ec  reports carry complete front matter, and may name the meeting
    6841afb  omit fields with nothing established
    621660a  show the model real JSON, and accept a mislabelled fence
    7355592  report a malformed fields declaration instead of ignoring it
    f313839  allow hyphens in declared field names
    3f351c7  Revert "allow hyphens in declared field names"
    52d22e3  record why declared field names are snake_case
    904bdf2  never send a rejected fields declaration to the model
    ac7cad7  carry a readable duration beside the seconds
    f8f4347  a JSON skeleton placeholder must mean "not established"
    f84b779  tell the model to quote time-shaped values
    2a58b47  split a template report into a data pass and a prose pass
    70d6324  the data pass reads the report as well as the transcript
    e22435a  run the data pass at temperature 0
    8644b4a  repair a stray quote in the data pass, and make the retry differ
    210dae5  field descriptions up to 1,200 characters, never cut
    1a65371  tell both template passes the day of the recording

Large and opinionated. Before investing in a clean PR, open an issue and find
out whether maintainers want the mechanism at all. A fork carrying this
indefinitely is a perfectly stable outcome.

Note for whoever extracts this: `f313839` and `3f351c7` are a feature and its
revert. That is honest history for us and noise for a reviewer — a submission
branch should be recomposed, not cherry-picked verbatim.

Added 2026-10-10, each decided by Chris that day:

- **A stray quote is repaired, and the retry differs** (`8644b4a`, with the
  retry temperature in `837d7c9`). *Problem:* 1 of 24 data passes returned
  invalid JSON although the request carried JSON mode: a German „ closed with
  an ASCII `"`, which ended the string early. The retry repeated the request
  at temperature 0, got the identical reply, and the report lost every field.
  *Design:* a quote inside a string that is not followed by `,` `:` `}` `]` or
  the end cannot close it, so it is escaped and the reply parsed again; the
  retry runs at 0.2, which earlier gave the same fields as 0. *Considered:*
  constrained decoding through `json_schema` (not probed on Osaurus yet); a
  JSON-repair dependency (bundle size, for one failure mode); a prompt rule
  about quotes (unreliable).
- **Descriptions up to 1,200 characters, never cut** (`210dae5`). *Problem:*
  every report written with thinking opened with stray `client:`, `title:`
  and other field lines. The seven field names the template's shared text
  mentioned are exactly the seven that leaked, and the nine it never mentioned
  never did (Qwen 3.6, 8 of 8 reports). A field's description is the only
  template text the data pass sees and the prose pass does not, so the rules
  moved there, and the client field's became about 1,050 characters, against a
  cap of 300 that cut without warning. *Design:* an over-long description is
  reported like any other unusable declaration (`TEMPLATE_FIELDS_INVALID`):
  the report keeps its prose and gets no fields. Saving a template does not
  check its fields block, here as before. *Considered:* a separate data-only
  section in the template (more mechanism for the same effect, and
  descriptions already sit beside their keys); stripping echoed lines from the
  report in code (treats the symptom of a template problem).
- **The day of the recording** (`1a65371`). *Problem:* a date said without a
  year came back as 2024 in 3 of 3 runs, and a relative one could not be
  resolved. *Design:* both template passes open with "This recording was made
  on Monday, 12 October 2026.", from the note's `date`, set by the recording
  pipeline and generate-report (and, on `build/caller-id`, by the late fields
  pass). The Standard summary and the title are unchanged.

### 7. Recording recovery after a write error — UPSTREAM CANDIDATE

    651d39b  recover the recording when the write stream errors   app/main.js

If the system-audio WriteStream errors mid-recording (ENOSPC, EIO), the stream
handler cleared the file path along with the stream, so `close()` reported "no
open file", nothing was queued, and the whole meeting sat orphaned in
`recordings/`. The fix keeps the path in failed-* slots and hands the
truncated WebM (still decodable) to processing; the renderer's "Recording may be
incomplete" notice is unchanged. Still present upstream in 0.8.0.

Written in September against 0.7.x (branch `fix/sysaudio-write-error-orphan`,
which is now stale) and ported to 0.8.0 on 2026-10-07. Only the test list in
`package.json` conflicted. 0.8.0's new `activeSysAudioSummaryFile` is not
cleared by the error handler, so the recovered audio and its note still pair
up. Its three tests pass, and the full unit suite (589 node, 282 vitest) passes
with it.

---

### 11. Where a recording came from — UPSTREAM CANDIDATE

    cab42ca  record which app a recording came from
    c04efca  record the meeting app for a recording started by hand too

Decided by Chris, 2026-10-10, as preparation for choosing a template per kind
of call (a long Google Meet is a board meeting in English, a phone call a
German support call, Discord a community call).

- *Problem:* the detected meeting app's bundle id was held in memory while
  recording and then lost. Nothing durable said whether a recording came from
  Discord, a browser, Zoom or a phone call, so no rule could use it, and no
  rule could be tested against past recordings.
- *Design:* a recording started from the "Meeting detected" notification
  records the detected app's bundle id in its note as `source_app`. Added
  once and never rewritten, kept by every save path as a key it does not own,
  exported like any other property, and reserved as a field name so a
  template cannot declare its own.
- *Manual starts* (`c04efca`, asked for by Chris the same day: most calls are
  recorded by hand). mic-monitor reports every app holding the microphone, at
  launch and on each change, and `app/mic-apps.js` keeps that set. A
  recording started any other way records the meeting app (the auto-detect
  allowlist) that most recently took the mic; one started before the call is
  dialled records the first meeting app to take the mic during it; `manual`
  means none did — an in-person meeting or a dictation.
- *Limits:* a Google Meet in a browser records the browser's id; only the Meet
  app has its own. Telling a board meeting from other browser calls will need
  more than the app (duration, language, a calendar).
- *Upstream:* independent of everything else here; small.

---

## The fork's e2e specs

Upstream's CLAUDE.md lists upstream's specs; these are the fork's. They run
with the rest of their tier (`cd app && npm run test:e2e -- --project=t1`, or `t2`).

- `frontmatter-duplicate-key.t2` (group 2): a repeated front matter key reads
  the same in the list and on the detail page.
- `report-properties.t1` (group 5): a report's properties are folded away
  until asked for, then shown in full. Seeded by
  `STENOAI_E2E_SEED_REPORT=frontmatter` in `app/e2e-mock-ipc.js`. Also in
  the upstream PR.

---

## Design decisions worth knowing

**Fields are declared inside the prompt, not in new UI.** A fenced ```fields
block in the template's own text:

    client: text — the other party, person or company
    changes: list — what was actually changed in a system, setting or file

`name: type` is already valid YAML, so the block parses with the same loader
the front matter uses. No new settings surface, no schema editor, and the
description reaches the model, so declaration and meaning cannot drift apart.

**JSON on the wire, YAML on disk.** The model is never asked to write YAML.
`title: Erika Mustermann: Synology-Zugriff` is a parse error when a model writes
it and correctly quoted when PyYAML does. Steno owns serialisation.

**Validate at generation, not at export.** At generation the model is still
available and a bad response can be retried. At export it is long gone and the
transcript may already have been purged.

**Two passes, not one.** A single completion was asked to satisfy a JSON schema
*and* write a report, and failures landed on whichever the model weighed less —
a field emitted as a bare `0:03` is invalid JSON, and the whole block failing to
parse lost every field, not just that one. Now: a data pass asking only for the
object, sent with `response_format: json_object` where the server supports it,
and a prose pass asking only for the report. A server can accept JSON mode
without enforcing it: Osaurus returned one invalid reply in 24 on 2026-10-10,
which is why the reply is also repaired (group 6, `8644b4a`).

**The data pass reads the prose report as well as the transcript.** The fields
that came back empty most often are the ones the prose pass has just written out
under headings. Measured at temperature 0 on a real call: transcript alone
filled 4 of 16 fields, report plus transcript filled 5, and the one recovered
was `changes`. The report is given alongside the transcript, never instead of
it, and the prompt says the transcript decides.

**The data pass runs at temperature 0, the prose pass does not.** Extraction is
a lookup; there is one right answer per field and it is already the likeliest
token. Measured: 0 and 0.2 gave identical fields across nine runs, and 0.3
produced a client name for a call in which nobody was named. Writing readable
German is the half that benefits from sampling.

**Front matter keys are snake_case, enforced.** Hyphens are valid YAML, JSON and
Obsidian property names and read better in a properties panel — but a bare
`next-steps` in a Dataview or Bases expression parses as subtraction. See
`f313839`/`3f351c7` for the full detour.

---

## Known weaknesses

**Fields still come back empty when the information is present.** The biggest
open problem. On the reference call the report's `## Diagnose` section contains
a full diagnosis and the `diagnosed` field returned null anyway, so this is not
an availability problem — the model will not commit. Prime suspect is the
null-bias in the generated instruction ("never guess to fill a field") plus
hedging in field descriptions ("the cause, *once established*"). Note that
over-tightening in the other direction collapsed extraction to 0 of 17 fields
twice, so this needs measurement, not conviction.

**Relative dates are the template's to resolve.** Until 2026-10-10 the model
was never told the date, and a date said without a year came back as 2024.
Both template passes are now told the day of the recording (group 6,
`1a65371`); whether a template resolves "nächste Woche Dienstag" against it
is a rule for the template to state.

**The template path does not chunk.** `_needs_chunking` and map-reduce guard the
Standard summary path only. A long transcript is sent whole to the template
path, and the failure mode would be a truncated or empty report with no error.
Not yet observed; the reference call is ten minutes.

**Declared cardinality is advice, not a rule.** "max 3 short phrases" in a
description is prose the model may ignore; nothing enforces it.

---

## Rebasing onto a new upstream

    git rebase --onto <new-tag> <old-tag> feat/template-fields

Do a trial run first, in a throwaway detached worktree, and resolve every
conflict there. Then rebase for real and take each resolution from the trial
commit, checking that `git write-tree` matches the trial commit's tree before
continuing. Finish with `git range-diff`: every commit should be `=` against
the trial.

**Predictions from history were wrong once already.** Across 0.7.x,
`src/summarizer.py` saw zero upstream commits and `app/main.js` nine, so the
forecast was "main.js is the only real conflict". In fact `main.js` merged
cleanly and the conflicts were elsewhere.

### v0.7.0 → v0.8.0, measured

25 upstream commits. 11 of the 22 files this branch touches changed upstream.
Four of 26 commits stopped:

| Commit | File | What happened | Resolution |
|---|---|---|---|
| `6f0d77b` YAML loader | `app/package-lock.json` | Version string only. Our change to the lockfile in this commit was a stale 0.6.7→0.7.0 bump that upstream had since fixed | Take upstream's file. Never regenerate it with a different npm: npm 11 rewrote ~30 unrelated `peer` flags |
| `d1d86c8` preserve keys | `simple_recorder.py` | Comment only. Upstream's reprocess now also drops `notes_stale`, which `_OWNED_FRONTMATTER_KEYS` already lists | Our code, upstream's comment |
| `476ba11` temperature | `src/summarizer.py` | Upstream moved query streaming into `stream_chat_prompt` | Upstream's code, plus `**self._cloud_kwargs()` on its OpenAI call (see group 4) |
| `aa4d652` front matter render | `markdown.tsx`, `markdown.test.ts` | Upstream replaced the hand-rolled chat renderer with react-markdown, deleting the code our additions were anchored to | Upstream's file plus `import yaml from 'js-yaml'` (not `cn`, which upstream removed); both `describe` blocks, closing braces placed by hand |

The other 22 applied unchanged. Checked after the rebase, because they merge
silently if broken:

- every front matter writer still goes through `_merge_preserved_frontmatter`,
  and upstream added no new writers or hand-rolled parsers;
- both report paths still call `apply_declared_fields`;
- the data pass carries `_data_pass_kwargs` (temperature 0) and the prose pass
  `_cloud_kwargs`;
- `config.json` round-trips unknown keys, so `auto_record_meetings_enabled`,
  `cloud_temperature` and `data_temperature` survive.

Tests, rebased tree against plain v0.8.0 in the same environment: pytest 1480
passed against 1435, `node --test` 581 against 578, vitest 282 against 276,
and no new failures. Each difference is exactly this branch's tests (45, 3, 6).
With `bin/` populated, as in the real checkout, four more pytest tests run
(1484) and the five `node --test` failures that need `steno-audio-encode`
pass (586/586).

The lesson still holds: additive code is cheap to carry. `src/templates.py`,
`src/report_store.py` and `app/obsidian-sync.js`, which upstream did not touch
in 0.8.0, cost nothing. What conflicted was code that edits upstream's own
functions in place, or appends next to code upstream later deletes.

Afterwards: rebuild (`../Callwatch-Claude/BUILDING-STENO.md`, and read its
toolchain-shadowing section — MacPorts and conda shadow Apple's tools and break
the build with misleading errors), then re-verify on a real call before trusting
it.

---

## Reproducing what runs

1. Check out `callwatch-build-2026-10-03` (or a later integration tip).
2. Build per `../Callwatch-Claude/BUILDING-STENO.md`.
3. Save `../Callwatch-Claude/templates/client-call.prompt.txt` into the app's
   own `config.json` as template id `support-call-fields` and make it the
   default — the file on disk is the source, but only the config copy runs.
4. Copy `../Callwatch-Claude/obsidian/callwatch-properties.css` into
   `<vault>/.obsidian/snippets/` and enable it.
