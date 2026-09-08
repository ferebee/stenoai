# tests/test_default_template_report.py
import json, tempfile, unittest
from pathlib import Path
from unittest import mock
from src.config import Config
import simple_recorder
from src import report_store


class _FakeSummarizer:
    model_name = "llama3.2:3b"
    def __init__(self, chunks):
        self._chunks = chunks
    def summarize_transcript_streaming(self, transcript, duration_minutes=0, language="en",
                                       notes=None, progress_callback=None, template_prompt=None,
                                       fields_instruction=""):
        # assert the template prompt is threaded through
        assert template_prompt, "expected a template prompt"
        self.last_fields_instruction = fields_instruction
        for c in self._chunks:
            yield c


def _cfg(tmp, default_id):
    c = Config(config_path=Path(tmp) / "config.json")
    # seed a custom template + set it default
    ok, _, saved = c.save_template({"name": "Leitung", "prompt": "Kurz für den Chef.",
                                    "language": "auto"})
    assert ok
    if default_id == "custom":
        c.set_default_template(saved["id"])
        return c, saved["id"]
    return c, "standard"


class DefaultTemplateReportTests(unittest.TestCase):
    def test_noop_when_default_is_standard(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "standard")
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["ignored"]))
            self.assertIsNone(out)
            self.assertFalse((Path(tmp) / "m_reports.json").exists())

    def test_generates_and_writes_sidecar_for_custom_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, tid = _cfg(tmp, "custom")
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["## Report\n- ok"]))
            self.assertIsNotNone(out)
            sc = report_store.load_sidecar(mp)
            self.assertEqual(len(sc["reports"]), 1)
            self.assertEqual(sc["reports"][0]["template_id"], tid)
            self.assertIn("## Report", sc["reports"][0]["content"])
            self.assertEqual(sc["active_report"], sc["reports"][0]["id"])

    def test_empty_generation_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "custom")
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["  ", "\n"]))
            self.assertIsNone(out)
            self.assertFalse((Path(tmp) / "m_reports.json").exists())

    def test_unknown_default_is_safe_noop(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "standard")
            c._config["default_template_id"] = "ghost"  # points at nothing
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["x"]))
            self.assertIsNone(out)

    def test_swallows_exceptions_writes_nothing(self):
        class _BoomSummarizer:
            model_name = "llama3.2:3b"
            def summarize_transcript_streaming(self, transcript, duration_minutes=0,
                                               language="en", notes=None,
                                               progress_callback=None, template_prompt=None):
                yield "## partial"
                raise RuntimeError("model exploded mid-stream")

        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "custom")
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            # Must not propagate: a new recording must never fail because of
            # the extra report.
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _BoomSummarizer())
            self.assertIsNone(out)
            self.assertFalse((Path(tmp) / "m_reports.json").exists())


if __name__ == "__main__":
    unittest.main()


_FIELDS_PROMPT = """Write a support record.

```fields
client: text — person or company on the call
systems_touched: list — systems involved
billable: checkbox (inferred) — is this billable
follow_up: date — only if a date was named
```

## Zusammenfassung
Three sentences."""


def _cfg_with_fields(tmp):
    c = Config(config_path=Path(tmp) / "config.json")
    ok, _, saved = c.save_template({"name": "Support", "prompt": _FIELDS_PROMPT,
                                    "language": "auto"})
    assert ok
    c.set_default_template(saved["id"])
    return c, saved["id"]


class DeclaredFieldsTests(unittest.TestCase):
    """A template's ```fields block becomes YAML front matter on its report."""

    def _run(self, tmp, model_output):
        c, tid = _cfg_with_fields(tmp)
        mp = Path(tmp) / "m_summary.md"
        mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
        out = simple_recorder.generate_default_template_report(
            mp, "T: hi", None, "en", 1, c, _FakeSummarizer([model_output]))
        return out, tid, report_store.load_sidecar(mp)

    def test_json_block_becomes_yaml_frontmatter(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, tid, sc = self._run(tmp,
                '```json\n{"client": "Erika Mustermann", '
                '"systems_touched": ["Synology", "Time Machine"], '
                '"billable": true, "follow_up": "2026-09-15"}\n```\n\n'
                '## Zusammenfassung\nEs ging um den Zugriff.\n')
            content = sc["reports"][0]["content"]
            self.assertTrue(content.startswith("---\n"))
            fm, body = report_store._split_frontmatter(content)
            self.assertEqual(fm["client"], "Erika Mustermann")
            self.assertEqual(fm["systems_touched"], ["Synology", "Time Machine"])
            self.assertIs(fm["billable"], True)
            self.assertEqual(fm["follow_up"], "2026-09-15")
            self.assertEqual(fm["inferred"], ["billable"])   # declared (inferred)
            self.assertEqual(fm["template_id"], tid)
            self.assertIn("Es ging um den Zugriff.", body)
            self.assertNotIn("```json", content)             # block consumed
            self.assertIn("raw_json", sc["reports"][0])      # kept beside, not inside

    def test_colon_in_a_value_is_quoted_not_broken(self):
        """The failure that motivated JSON-on-the-wire: a model writing this as
        YAML produces a ScannerError; PyYAML quotes it."""
        with tempfile.TemporaryDirectory() as tmp:
            _, _, sc = self._run(tmp,
                '```json\n{"client": "Erika Mustermann: Synology-Zugriff"}\n```\n\nprose\n')
            fm, _ = report_store._split_frontmatter(sc["reports"][0]["content"])
            self.assertEqual(fm["client"], "Erika Mustermann: Synology-Zugriff")

    def test_wrong_type_is_omitted_not_passed_through(self):
        """A mismatch must never put prose into a Date property. The field is
        dropped rather than emitted as null — Obsidian treats missing and null
        the same, and a null clutters the Properties panel."""
        with tempfile.TemporaryDirectory() as tmp:
            _, _, sc = self._run(tmp,
                '```json\n{"follow_up": "nächste Woche", "billable": "vielleicht"}\n```\n\nprose\n')
            fm, _ = report_store._split_frontmatter(sc["reports"][0]["content"])
            self.assertNotIn("follow_up", fm)
            self.assertNotIn("billable", fm)

    def test_unknown_keys_dropped_and_unestablished_fields_omitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, _, sc = self._run(tmp,
                '```json\n{"client": "X", "invented": "y"}\n```\n\nprose\n')
            fm, _ = report_store._split_frontmatter(sc["reports"][0]["content"])
            self.assertNotIn("invented", fm)      # not declared
            self.assertNotIn("systems_touched", fm)  # declared but not established
            self.assertEqual(fm["client"], "X")

    def test_false_is_a_real_answer_and_survives(self):
        """`false` is an answer, not an absence — unlike null or []."""
        with tempfile.TemporaryDirectory() as tmp:
            _, _, sc = self._run(tmp,
                '```json\n{"billable": false, "systems_touched": []}\n```\n\nprose\n')
            fm, _ = report_store._split_frontmatter(sc["reports"][0]["content"])
            self.assertIs(fm["billable"], False)
            self.assertNotIn("systems_touched", fm)

    def test_no_json_block_retries_then_degrades_to_prose(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, tid = _cfg_with_fields(tmp)
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            fake = _FakeSummarizer(["## Report\nno json here"])
            out = simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, fake)
            self.assertIsNotNone(out)          # never lose the report
            sc = report_store.load_sidecar(mp)
            content = sc["reports"][0]["content"]
            self.assertFalse(content.startswith("---"))   # prose only
            self.assertIn("no json here", content)

    def test_template_without_fields_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, _ = _cfg(tmp, "custom")     # plain prompt, no fields block
            mp = Path(tmp) / "m_summary.md"
            mp.write_text("---\n---\n\n## Summary\nx\n", encoding="utf-8")
            simple_recorder.generate_default_template_report(
                mp, "T: hi", None, "en", 1, c, _FakeSummarizer(["## Report\n- ok"]))
            content = report_store.load_sidecar(mp)["reports"][0]["content"]
            self.assertEqual(content, "## Report\n- ok")


class ReportCompletenessTests(unittest.TestCase):
    """A report must be a COMPLETE markdown document: note metadata plus the
    declared fields, so nothing has to be reassembled at export."""

    def _run(self, tmp, model_output, note_title="Note"):
        # This template declares a title of its own, which the others do not.
        c = Config(config_path=Path(tmp) / "config.json")
        ok, _, saved = c.save_template({
            "name": "Titled", "language": "auto",
            "prompt": "Write a record.\n\n```fields\n"
                      "title: text — short title, prefixed with the client\n"
                      "client: text — who was on the call\n"
                      "```\n\n## Zusammenfassung\nShort.",
        })
        assert ok
        c.set_default_template(saved["id"])
        tid = saved["id"]
        mp = Path(tmp) / "m_summary.md"
        mp.write_text(
            f'---\ntitle: "{note_title}"\ndate: "2026-09-06T11:54:16"\n'
            'duration_seconds: 587\nlanguage: "de"\n'
            'configured_language: "auto"\nis_diarised: true\nfolders: []\n'
            '---\n\n## Summary\nx\n', encoding="utf-8")
        simple_recorder.generate_default_template_report(
            mp, "T: hi", None, "de", 9, c, _FakeSummarizer([model_output]))
        return mp, tid, report_store.load_sidecar(mp)

    def test_report_carries_note_metadata_but_not_internal_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, tid, sc = self._run(tmp, '```json\n{"client": "ABC"}\n```\n\nprose\n')
            fm, _ = report_store._split_frontmatter(sc["reports"][0]["content"])
            self.assertEqual(fm["date"], "2026-09-06T11:54:16")
            self.assertEqual(fm["duration_seconds"], 587)
            self.assertEqual(fm["language"], "de")
            for internal in ("configured_language", "is_diarised", "folders"):
                self.assertNotIn(internal, fm)
            # note metadata precedes the declared fields
            keys = list(fm)
            self.assertLess(keys.index("date"), keys.index("client"))

    def test_declared_title_names_an_unnamed_meeting(self):
        with tempfile.TemporaryDirectory() as tmp:
            mp, _, sc = self._run(
                tmp, '```json\n{"title": "ABC GmbH: Exchange"}\n```\n\nprose\n',
                note_title="Note")
            note_fm, _ = report_store._split_frontmatter(mp.read_text(encoding="utf-8"))
            self.assertEqual(note_fm["title"], "ABC GmbH: Exchange")

    def test_declared_title_never_overwrites_a_chosen_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            mp, _, _ = self._run(
                tmp, '```json\n{"title": "ABC GmbH: Exchange"}\n```\n\nprose\n',
                note_title="Erika Mustermann wg. Scanner")
            note_fm, _ = report_store._split_frontmatter(mp.read_text(encoding="utf-8"))
            self.assertEqual(note_fm["title"], "Erika Mustermann wg. Scanner")

    def test_auto_detect_placeholder_is_also_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            mp, _, _ = self._run(
                tmp, '```json\n{"title": "ABC GmbH: Exchange"}\n```\n\nprose\n',
                note_title="Call — 2026-09-06 11:54")
            note_fm, _ = report_store._split_frontmatter(mp.read_text(encoding="utf-8"))
            self.assertEqual(note_fm["title"], "ABC GmbH: Exchange")


class JsonBlockToleranceTests(unittest.TestCase):
    """The model has to emit a fenced json block. Accept near-misses on the
    fence LABEL — a model once emitted ```fields, copying the declaration's own
    shape — and let json.loads be the real test of usability."""

    def test_untagged_fence_is_accepted(self):
        data, prose = simple_recorder._split_json_block(
            '```\n{"client": "ABC"}\n```\n\nprose here\n')
        self.assertEqual(data, {"client": "ABC"})
        self.assertEqual(prose, "prose here")

    def test_wrong_label_is_accepted_when_the_content_is_json(self):
        data, _ = simple_recorder._split_json_block(
            '```JSON\n{"client": "ABC"}\n```\n\nprose\n')
        self.assertEqual(data, {"client": "ABC"})

    def test_a_non_json_block_is_skipped_and_a_later_json_block_found(self):
        data, prose = simple_recorder._split_json_block(
            '```fields\nclient: ABC\n```\n\n```json\n{"client": "ABC"}\n```\n\nprose\n')
        self.assertEqual(data, {"client": "ABC"})
        self.assertIn("```fields", prose)   # only the json block is consumed

    def test_no_json_anywhere_returns_none_and_keeps_everything(self):
        text = '```fields\nclient: ABC\nsymptoms: null\n```\n\nprose\n'
        data, prose = simple_recorder._split_json_block(text)
        self.assertIsNone(data)
        self.assertEqual(prose, text.strip())


class MalformedFieldsBlockTests(unittest.TestCase):
    """A broken declaration must be loud. Silently reading it as 'no fields'
    made a template run as plain prose with no extraction and no complaint."""

    def test_colon_in_a_description_is_reported(self):
        from src.templates import parse_fields_block
        fields, _, err = parse_fields_block(
            "Prose.\n\n```fields\n"
            "client: text — the OTHER party: person or company\n"
            "```\n")
        self.assertEqual(fields, [])
        self.assertIsNotNone(err)
        self.assertIn("not valid YAML", err)

    def test_absent_block_is_not_an_error(self):
        from src.templates import parse_fields_block
        fields, prose, err = parse_fields_block("Just prose, no declaration.")
        self.assertEqual(fields, [])
        self.assertIsNone(err)
        self.assertEqual(prose, "Just prose, no declaration.")

    def test_declared_fields_for_surfaces_the_error(self):
        fields, _, instruction = simple_recorder.declared_fields_for(
            "Prose.\n\n```fields\nclient: text — a: b\n```\n", "tid")
        self.assertEqual(fields, [])
        self.assertEqual(instruction, "")
