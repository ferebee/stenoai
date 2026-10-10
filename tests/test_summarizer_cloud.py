# tests/test_summarizer_cloud.py
import tempfile
from unittest import mock
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


class CloudRequestsConfigTests(unittest.TestCase):
    """cloud_requests is opt-in per kind: anything missing or invalid adds
    nothing to a request."""

    def _cfg(self, tmp, value):
        c = Config(config_path=Path(tmp) / "config.json")
        c._config["cloud_requests"] = value
        return c

    def test_unset_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = Config(config_path=Path(tmp) / "config.json")
            self.assertEqual(c.get_cloud_requests(), {})

    def test_valid_settings_come_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self._cfg(tmp, {
                "title": {"timeout": 60, "retries": 0,
                          "extra_body": {"enable_thinking": False}},
                "summary": {"extra_body": {"enable_thinking": False}},
            })
            self.assertEqual(c.get_cloud_requests(), {
                "title": {"timeout": 60.0, "retries": 0,
                          "extra_body": {"enable_thinking": False}},
                "summary": {"extra_body": {"enable_thinking": False}},
            })

    def test_invalid_entries_are_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self._cfg(tmp, {
                "titel": {"timeout": 60},                 # unknown kind
                "report": "fast",                         # not an object
                "data": {"timeout": True, "retries": -1, "extra_body": ["x"]},
                "title": {"timeout": "60", "retries": 2.5, "extra_body": {"a": 1}},
            })
            self.assertEqual(c.get_cloud_requests(), {"title": {"extra_body": {"a": 1}}})

    def test_not_an_object_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self._cfg(tmp, ["title"]).get_cloud_requests(), {})


class _FakeCompletions:
    def __init__(self, client):
        self.client = client

    def create(self, **kwargs):
        self.client.calls.append(kwargs)
        if self.client.fail:
            raise TimeoutError("timed out")
        if kwargs.get("stream"):
            return iter(())
        message = type("Message", (), {"content": " Ein Titel "})()
        choice = type("Choice", (), {"message": message})()
        return type("Response", (), {"choices": [choice]})()


class _FakeClient:
    """Records every create() call; with_options() records the options."""

    def __init__(self, fail=False, options=None, calls=None):
        self.fail, self.options = fail, options or {}
        self.calls = [] if calls is None else calls
        self.chat = type("Chat", (), {})()
        self.chat.completions = _FakeCompletions(self)

    def with_options(self, **options):
        return _FakeClient(self.fail, options, self.calls)


def _cloud_summarizer(requests=None, fail=False):
    s = OllamaSummarizer.__new__(OllamaSummarizer)
    s.ollama_process = None
    s.ai_provider, s.cloud_provider, s.model_name = "cloud", "custom", "m"
    s.cloud_temperature, s.data_temperature = 0.3, 0.0
    s.cloud_requests = requests or {}
    s.cloud_client = _FakeClient(fail=fail)
    return s


class CloudRequestsTests(unittest.TestCase):
    def test_kind_settings_reach_the_kwargs(self):
        s = _cloud_summarizer({"title": {"timeout": 60.0,
                                         "extra_body": {"enable_thinking": False}}})
        self.assertEqual(s._cloud_kwargs("title"), {
            "temperature": 0.3, "timeout": 60.0,
            "extra_body": {"enable_thinking": False}})
        self.assertEqual(s._cloud_kwargs("report"), {"temperature": 0.3})
        self.assertEqual(s._cloud_kwargs(), {"temperature": 0.3})

    def test_title_unconfigured_is_unchanged(self):
        """Three attempts at 30 s, through the client as configured."""
        s = _cloud_summarizer(fail=True)
        with mock.patch("src.summarizer.time.sleep"):
            with self.assertRaises(TimeoutError):
                s._cloud_chat("p", 30, kind="title")
        self.assertEqual(len(s.cloud_client.calls), 3)
        self.assertEqual(s.cloud_client.calls[0]["timeout"], 30)
        self.assertNotIn("extra_body", s.cloud_client.calls[0])

    def test_title_with_settings(self):
        s = _cloud_summarizer({"title": {"timeout": 60.0, "retries": 0,
                                         "extra_body": {"enable_thinking": False}}},
                              fail=True)
        with mock.patch("src.summarizer.time.sleep"):
            with self.assertRaises(TimeoutError):
                s._cloud_chat("p", 30, kind="title")
        self.assertEqual(len(s.cloud_client.calls), 1, "retries 0 is one attempt")
        call = s.cloud_client.calls[0]
        self.assertEqual(call["timeout"], 60.0)
        self.assertEqual(call["extra_body"], {"enable_thinking": False})

    def test_retries_turn_off_the_sdk_retries(self):
        s = _cloud_summarizer({"title": {"retries": 1}})
        self.assertEqual(s._openai_client_for("title").options, {"max_retries": 0})
        self.assertIs(s._openai_client_for("summary"), s.cloud_client)

    def test_generate_title_asks_as_title(self):
        s = _cloud_summarizer({"title": {"extra_body": {"enable_thinking": False}}})
        self.assertEqual(s.generate_title("Zusammenfassung", "", "en"), "Ein Titel")
        self.assertEqual(s.cloud_client.calls[0]["extra_body"], {"enable_thinking": False})

    def test_streamed_summary_and_report_use_their_kinds(self):
        s = _cloud_summarizer({"summary": {"extra_body": {"a": 1}},
                               "report": {"extra_body": {"b": 2}}})
        for template_prompt, expected in ((None, {"a": 1}), ("Bericht", {"b": 2})):
            s.cloud_client.calls.clear()
            with self.assertRaises(ValueError):   # the fake streams nothing
                list(s.summarize_transcript_streaming(
                    "[You] Hallo", 1, "en", template_prompt=template_prompt))
            self.assertEqual(s.cloud_client.calls[0]["extra_body"], expected)

    def test_data_pass_uses_data_settings(self):
        s = _cloud_summarizer({"data": {"extra_body": {"enable_thinking": True}}})
        s.complete_json("p")
        call = s.cloud_client.calls[0]
        self.assertEqual(call["extra_body"], {"enable_thinking": True})
        self.assertEqual(call["temperature"], 0.0)
        self.assertEqual(call["response_format"], {"type": "json_object"})


class DataRetryTemperatureTests(unittest.TestCase):
    """A retry at temperature 0 repeats the request that just failed and gets
    the same reply; the retry has to differ."""

    def test_retry_is_warmer_than_zero(self):
        s = _cloud_summarizer()
        s.complete_json("p", retry=True)
        self.assertEqual(s.cloud_client.calls[0]["temperature"],
                         OllamaSummarizer.DATA_RETRY_TEMPERATURE)

    def test_a_warmer_setting_is_kept(self):
        s = _cloud_summarizer()
        s.data_temperature = 0.5
        s.complete_json("p", retry=True)
        self.assertEqual(s.cloud_client.calls[0]["temperature"], 0.5)

    def test_first_attempt_is_unchanged(self):
        s = _cloud_summarizer()
        s.complete_json("p")
        self.assertEqual(s.cloud_client.calls[0]["temperature"], 0.0)


if __name__ == "__main__":
    unittest.main()
