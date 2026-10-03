# This fork, against upstream

Base: **upstream v0.7.0**. Branch: `feat/template-fields`, 26 commits.
Known-good tag: `callwatch-build-2026-09-09` — the build in daily use.

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

## The six groups

Listed oldest first. The grouping is what matters for upstreaming — the branch
is linear, but it is not one change.

### 1. Auto-record — LOCAL ONLY

    512f961  Add opt-in auto-record for detected meetings       app/main.js

Starts recording when Steno's own meeting detector fires, instead of showing a
notification. Deliberately not for upstream: it is a behavioural preference,
and it is the single change in `app/main.js`, which upstream edits constantly.
Expect this to be the only real conflict on any rebase.

### 2. Front matter correctness — UPSTREAM CANDIDATE, send first

    b7b54ad  parse with a real YAML loader in both readers
    d7fae2c  preserve keys the save paths do not own
    c6bd6a5  parse front matter with a real YAML loader here too

Three hand-rolled front matter parsers existed, in `app/main.js`,
`src/report_store.py` and `app/obsidian-sync.js`. Each mangled a different real
value: a colon inside a title, a list item that read as a key. All three now
use a real loader (js-yaml / PyYAML), and the save paths no longer drop keys
they do not own.

These are pure bug fixes with no dependency on the rest of the branch, which is
why they should go upstream first — every commit accepted upstream is one fewer
to carry through every future rebase.

### 3. Obsidian export of the active report — UPSTREAM CANDIDATE

    b7a514c  export the active template report, not just the Standard note

The sync exported the Standard note even when a template report was the one on
screen. Independent of everything else here.

### 4. Configurable sampling temperature — UPSTREAM CANDIDATE

    0255556  allow a configured sampling temperature
    9575988  give the data pass its own temperature setting

Steno omitted the parameter entirely, taking each server's default — typically
around 0.7, which is high for a task that is mostly extraction. Now
configurable, and the two passes are configured separately (see group 6).

### 5. Report front matter rendering — UPSTREAM CANDIDATE

    6b43fd8  render a report's front matter as properties, not as prose

react-markdown has no concept of front matter, so a report opening with `---`
rendered as a horizontal rule followed by every key collapsed into one run-on
paragraph. Now split off and drawn as a compact key/value header.

Worth upstreaming on its own merit rather than as part of the feature below: a
user-written markdown template can ask for YAML front matter in stock Steno
today, and it renders as garbage.

### 6. Declared fields — THE FEATURE, discuss before building a PR

    ec67294  declared fields become YAML front matter on the report
    464ed05  allow a declared 'title' field, reserve the derived keys
    698a2af  extract declared fields on every report path
    4370045  reports carry complete front matter, and may name the meeting
    145d8f4  omit fields with nothing established
    6c9f04c  show the model real JSON, and accept a mislabelled fence
    373d17f  report a malformed fields declaration instead of ignoring it
    1cca751  allow hyphens in declared field names
    a6d8acc  Revert "allow hyphens in declared field names"
    9f5e5d0  record why declared field names are snake_case
    68fd236  never send a rejected fields declaration to the model
    5bd6d7e  carry a readable duration beside the seconds
    1352bf1  a JSON skeleton placeholder must mean "not established"
    b20bf8e  tell the model to quote time-shaped values
    0dddc7a  split a template report into a data pass and a prose pass
    08a8f0c  the data pass reads the report as well as the transcript
    00f3366  run the data pass at temperature 0

Large and opinionated. Before investing in a clean PR, open an issue and find
out whether maintainers want the mechanism at all. A fork carrying this
indefinitely is a perfectly stable outcome.

Note for whoever extracts this: `1cca751` and `a6d8acc` are a feature and its
revert. That is honest history for us and noise for a reviewer — a submission
branch should be recomposed, not cherry-picked verbatim.

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
`1cca751`/`a6d8acc` for the full detour.

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

    git rebase --onto <new-tag> v0.7.0 feat/template-fields

Conflict cost is concentrated where upstream edits the same files. Measured
across upstream's 0.7.x line: `src/summarizer.py`, `src/templates.py` and
`app/obsidian-sync.js` saw **zero** upstream commits, `simple_recorder.py` four,
`app/renderer/.../MeetingDetail.tsx` three, and `app/main.js` **nine** — which
is group 1, the one-file local-only change.

The lesson generalises: additive code is cheap to carry. `src/templates.py` is a
new file and its conflict surface is zero by construction.

Afterwards: rebuild (`../Callwatch-Claude/BUILDING-STENO.md`, and read its
toolchain-shadowing section — MacPorts and conda shadow Apple's tools and break
the build with misleading errors), then re-verify on a real call before trusting
it.

---

## Reproducing what runs

1. Check out `callwatch-build-2026-09-09` (or a later integration tip).
2. Build per `../Callwatch-Claude/BUILDING-STENO.md`.
3. Save `../Callwatch-Claude/templates/client-call.prompt.txt` into the app's
   own `config.json` as template id `support-call-fields` and make it the
   default — the file on disk is the source, but only the config copy runs.
4. Copy `../Callwatch-Claude/obsidian/callwatch-properties.css` into
   `<vault>/.obsidian/snippets/` and enable it.
