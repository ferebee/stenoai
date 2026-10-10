# tests/test_source_app.py
"""A note records which app its recording came from, as `source_app`."""
import tempfile
import unittest
from pathlib import Path

import simple_recorder
from src import report_store
from src.templates import validate_fields


class StampSourceAppTests(unittest.TestCase):
    def _note(self, tmp, front):
        p = Path(tmp) / "sysaudio-1-Note_summary.md"
        p.write_text(f"---\n{front}---\n\n## Summary\nx\n", encoding="utf-8")
        return p

    def test_added_to_the_front_matter(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._note(tmp, 'title: "Note"\n')
            self.assertTrue(simple_recorder._stamp_source_app(p, "com.hnc.Discord"))
            fm, body = report_store._split_frontmatter(p.read_text(encoding="utf-8"))
            self.assertEqual(fm, {"title": "Note", "source_app": "com.hnc.Discord"})
            self.assertIn("## Summary", body)

    def test_an_empty_front_matter_takes_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._note(tmp, "")
            self.assertTrue(simple_recorder._stamp_source_app(p, "manual"))
            fm, _ = report_store._split_frontmatter(p.read_text(encoding="utf-8"))
            self.assertEqual(fm, {"source_app": "manual"})

    def test_an_existing_value_is_never_rewritten(self):
        """A reprocess or a continued recording must not change where the
        recording came from."""
        with tempfile.TemporaryDirectory() as tmp:
            p = self._note(tmp, 'source_app: "com.apple.avconferenced"\n')
            self.assertFalse(simple_recorder._stamp_source_app(p, "manual"))
            fm, _ = report_store._split_frontmatter(p.read_text(encoding="utf-8"))
            self.assertEqual(fm["source_app"], "com.apple.avconferenced")

    def test_nothing_to_record_or_nowhere_to_record_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._note(tmp, 'title: "Note"\n')
            before = p.read_text(encoding="utf-8")
            self.assertFalse(simple_recorder._stamp_source_app(p, None))
            self.assertFalse(simple_recorder._stamp_source_app(None, "manual"))
            self.assertFalse(simple_recorder._stamp_source_app(Path(tmp) / "missing.md", "manual"))
            self.assertEqual(p.read_text(encoding="utf-8"), before)

    def test_a_later_save_keeps_it(self):
        """Every save path rebuilds the front matter from its own keys and
        carries forward the ones it does not own."""
        with tempfile.TemporaryDirectory() as tmp:
            p = self._note(tmp, 'title: "Note"\n')
            simple_recorder._stamp_source_app(p, "com.google.Chrome")
            merged = simple_recorder._merge_preserved_frontmatter(p, {"title": "New"})
            self.assertEqual(merged["source_app"], "com.google.Chrome")

    def test_a_template_cannot_declare_it(self):
        ok, err = validate_fields([{"name": "source_app", "type": "text",
                                    "basis": "stated", "description": ""}])
        self.assertFalse(ok)
        self.assertIn("reserved", err)


if __name__ == "__main__":
    unittest.main()
