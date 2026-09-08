# tests/test_summarizer_cloud.py
import tempfile
import unittest
from pathlib import Path

from src.config import Config
from src.summarizer import OllamaSummarizer


class CloudTemperatureConfigTests(unittest.TestCase):
    """Temperature is opt-in: unset means the parameter is not sent at all, so
    an unconfigured install behaves exactly as it always has."""

    def _cfg(self, tmp):
        return Config(config_path=Path(tmp) / "config.json")

    def test_unset_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(self._cfg(tmp).get_cloud_temperature())

    def test_round_trips(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self._cfg(tmp)
            self.assertTrue(c.set_cloud_temperature(0.2))
            self.assertEqual(c.get_cloud_temperature(), 0.2)

    def test_clamped_to_the_valid_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self._cfg(tmp)
            c.set_cloud_temperature(9)
            self.assertEqual(c.get_cloud_temperature(), 2.0)
            c.set_cloud_temperature(-1)
            self.assertEqual(c.get_cloud_temperature(), 0.0)

    def test_garbage_is_rejected_not_stored(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self._cfg(tmp)
            self.assertFalse(c.set_cloud_temperature("abc"))
            self.assertIsNone(c.get_cloud_temperature())

    def test_none_clears_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self._cfg(tmp)
            c.set_cloud_temperature(0.5)
            c.set_cloud_temperature(None)
            self.assertIsNone(c.get_cloud_temperature())


class CloudKwargsTests(unittest.TestCase):
    def test_no_temperature_sends_no_parameter(self):
        s = OllamaSummarizer.__new__(OllamaSummarizer)
        s.cloud_temperature = None
        self.assertEqual(s._cloud_kwargs(), {})

    def test_temperature_is_passed_through(self):
        s = OllamaSummarizer.__new__(OllamaSummarizer)
        s.cloud_temperature = 0.2
        self.assertEqual(s._cloud_kwargs(), {"temperature": 0.2})

    def test_missing_attribute_is_safe(self):
        """Non-cloud providers never set it; the call must not raise."""
        s = OllamaSummarizer.__new__(OllamaSummarizer)
        self.assertEqual(s._cloud_kwargs(), {})


if __name__ == "__main__":
    unittest.main()
