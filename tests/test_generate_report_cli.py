# tests/test_generate_report_cli.py
import json
import tempfile
import unittest
from pathlib import Path

from click.testing import CliRunner
from unittest import mock

import simple_recorder
from src import report_store
from src.config import Config

_MD_TEMPLATE = """\
---
language: en
duration_seconds: 600
---
## Summary

Existing summary

## Transcript

{transcript}
"""


def _write_summary(tmp, transcript="Alice: hi. Bob: bye."):
    p = Path(tmp) / "meeting_summary.md"
    p.write_text(_MD_TEMPLATE.format(transcript=transcript))
    return p


class GenerateReportCliTests(unittest.TestCase):
    def test_unknown_template_emits_stream_error_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            with mock.patch("src.config.get_config", return_value=cfg):
                res = CliRunner().invoke(
                    simple_recorder.generate_report,
                    [str(summary), "does-not-exist"],
                )
            self.assertNotEqual(res.exit_code, 0)
            self.assertIn("STREAM_ERROR", res.output)
            # No sidecar written.
            sidecar_p = report_store.sidecar_path(summary)
            self.assertFalse(sidecar_p.exists())

    def test_empty_stream_emits_stream_error_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            fake_summarizer = mock.MagicMock()
            fake_summarizer.model_name = "llama3.2:3b"
            # Stream yields only whitespace → must be treated as empty.
            fake_summarizer.summarize_transcript_streaming.return_value = iter(["   ", "\n"])

            with mock.patch("src.config.get_config", return_value=cfg), \
                 mock.patch("src.summarizer.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.generate_report,
                    [str(summary), "standard"],
                )
            self.assertNotEqual(res.exit_code, 0)
            self.assertIn("STREAM_ERROR", res.output)
            self.assertIn("empty report", res.output)
            # No sidecar written.
            sidecar_p = report_store.sidecar_path(summary)
            self.assertFalse(sidecar_p.exists())

    def test_valid_stream_writes_before_stream_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")

            fake_summarizer = mock.MagicMock()
            fake_summarizer.model_name = "llama3.2:3b"
            fake_summarizer.summarize_transcript_streaming.return_value = iter(
                ["## Report\n", "- body"]
            )

            with mock.patch("src.config.get_config", return_value=cfg), \
                 mock.patch("src.summarizer.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.generate_report,
                    [str(summary), "standard"],
                )
            self.assertEqual(res.exit_code, 0, res.output)
            # Ordering: the sidecar is written before STREAM_COMPLETE is emitted.
            self.assertIn("STREAM_COMPLETE", res.output)
            # Report landed in the sidecar, NOT the meeting file.
            sidecar_p = report_store.sidecar_path(summary)
            self.assertTrue(sidecar_p.exists(), "sidecar file should exist")
            sidecar = json.loads(sidecar_p.read_text())
            self.assertEqual(len(sidecar["reports"]), 1)
            self.assertIn("body", sidecar["reports"][0]["content"])
            self.assertEqual(sidecar["active_report"], sidecar["reports"][0]["id"])
            # Meeting file itself must NOT be modified (it's still a .md).
            self.assertTrue(summary.read_text().startswith("---"))

    def test_declared_fields_are_extracted_on_this_path_too(self):
        """Regression: field extraction was wired into the recording pipeline
        only, so this command produced prose with the raw json block left in."""
        with tempfile.TemporaryDirectory() as tmp:
            summary = _write_summary(tmp)
            cfg = Config(config_path=Path(tmp) / "config.json")
            ok, _, saved = cfg.save_template({
                "name": "Fields", "language": "auto",
                "prompt": "Write a record.\n\n```fields\n"
                          "client: text — who was on the call\n"
                          "billable: checkbox (inferred) — is this billable\n"
                          "```\n\n## Zusammenfassung\nShort.",
            })
            assert ok

            fake_summarizer = mock.MagicMock()
            fake_summarizer.model_name = "llama3.2:3b"
            # Two passes now: the prose pass streams the report, the data pass
            # returns the object on its own.
            fake_summarizer.summarize_transcript_streaming.return_value = iter([
                "## Zusammenfassung\nEs lief gut.\n",
            ])
            fake_summarizer.extract_fields_json.return_value = (
                '{"client": "ABC GmbH", "billable": true}')

            with mock.patch("src.config.get_config", return_value=cfg), \
                 mock.patch("src.summarizer.OllamaSummarizer", return_value=fake_summarizer):
                res = CliRunner().invoke(
                    simple_recorder.generate_report, [str(summary), saved["id"]])
            self.assertEqual(res.exit_code, 0, res.output)

            content = json.loads(report_store.sidecar_path(summary).read_text())["reports"][0]
            fm, body = report_store._split_frontmatter(content["content"])
            self.assertEqual(fm["client"], "ABC GmbH")
            self.assertIs(fm["billable"], True)
            self.assertEqual(fm["inferred"], ["billable"])
            self.assertEqual(fm["template_id"], saved["id"])
            self.assertIn("Es lief gut.", body)
            self.assertNotIn("```json", content["content"])
            self.assertIn("raw_json", content)

            # Each pass is asked for one thing. The data pass carries the
            # generated instruction and ran exactly once — no retry was needed.
            self.assertEqual(fake_summarizer.extract_fields_json.call_count, 1)
            data_args = fake_summarizer.extract_fields_json.call_args.args
            self.assertIn("client", data_args[2])          # fields_instruction
            self.assertNotIn("```fields", data_args[1])    # prose guidance only

            # And the prose pass never sees the field declaration at all.
            prose = fake_summarizer.summarize_transcript_streaming.call_args
            self.assertNotIn("fields_instruction", prose.kwargs)
            self.assertNotIn("```fields", prose.kwargs["template_prompt"])


if __name__ == "__main__":
    unittest.main()
