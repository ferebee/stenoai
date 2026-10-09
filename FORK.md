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

## The seven groups

Listed oldest first. The grouping is what matters for upstreaming — the branch
is linear, but it is not one change.

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

### 3. Obsidian export of the active report — UPSTREAM CANDIDATE

    3baea6e  export the active template report, not just the Standard note

The sync exported the Standard note even when a template report was the one on
screen. Independent of everything else here.

### 4. Configurable sampling temperature — UPSTREAM CANDIDATE

    476ba11  allow a configured sampling temperature
    9729711  give the data pass its own temperature setting

Steno omitted the parameter entirely, taking each server's default — typically
around 0.7, which is high for a task that is mostly extraction. Now
configurable, and the two passes are configured separately (see group 6).

The setting works by adding `**self._cloud_kwargs()` to each OpenAI-compatible
call, so a call site upstream adds later silently lacks it. That happened in
0.8.0: query streaming moved into a new `stream_chat_prompt`, and the rebase
had to carry the kwargs there by hand. After any rebase, check every
`cloud_client.chat.completions.create` in `src/summarizer.py`.

### 5. Report front matter rendering — UPSTREAM CANDIDATE

    aa4d652  render a report's front matter as properties, not as prose

react-markdown has no concept of front matter, so a report opening with `---`
rendered as a horizontal rule followed by every key collapsed into one run-on
paragraph. Now split off and drawn as a compact key/value header.

Worth upstreaming on its own merit rather than as part of the feature below: a
user-written markdown template can ask for YAML front matter in stock Steno
today, and it renders as garbage.

Not submittable as it stands: `npm run lint:i18n` fails on it, because
`PropertyValue` renders the literal strings `'yes'` and `'no'`. Upstream's
gate allows zero hardcoded strings in `markdown.tsx`. Route them through
`t()` before cutting a submission branch. (The fork has failed this gate since
the commit landed; the rebase did not cause it.)

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

Large and opinionated. Before investing in a clean PR, open an issue and find
out whether maintainers want the mechanism at all. A fork carrying this
indefinitely is a perfectly stable outcome.

Note for whoever extracts this: `f313839` and `3f351c7` are a feature and its
revert. That is honest history for us and noise for a reviewer — a submission
branch should be recomposed, not cherry-picked verbatim.

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
and a prose pass asking only for the report.

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

**Relative dates cannot be resolved.** A `date` field returns null for "nächste
Woche Dienstag" because the model is never told today's date. Steno knows the
recording date; injecting it would fix every date field at once.

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
