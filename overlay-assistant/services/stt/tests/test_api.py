from __future__ import annotations

import unittest
from dataclasses import replace
from unittest.mock import patch

from fastapi.testclient import TestClient

import live_rhetoric_stt.main as main
from test_service import wav_bytes


class FakeResult:
    def to_dict(self):
        return {
            "text": "Local API transcript.",
            "model": main.settings.model_id,
            "language": "en",
            "audioSeconds": 0.5,
        }


class FakeService:
    def __init__(self):
        self.calls = []

    def transcribe(self, payload, language):
        self.calls.append((payload, language))
        return FakeResult()


class LocalSttApiTests(unittest.TestCase):
    def test_models_and_openai_compatible_transcription(self) -> None:
        fake_service = FakeService()
        with patch.object(main, "service", fake_service):
            with TestClient(main.app) as client:
                models = client.get("/v1/models")
                response = client.post(
                    "/v1/audio/transcriptions",
                    files={"file": ("turn.wav", wav_bytes(), "audio/wav")},
                    data={
                        "model": main.settings.model_id,
                        "language": "en",
                        "response_format": "json",
                    },
                )

        self.assertEqual(models.status_code, 200)
        self.assertEqual(models.json()["data"][0]["id"], main.settings.model_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "Local API transcript.")
        self.assertEqual(fake_service.calls[0][1], "en")

    def test_optional_bearer_auth_is_enforced(self) -> None:
        protected = replace(main.settings, api_token="private-token")
        with patch.object(main, "settings", protected):
            with TestClient(main.app) as client:
                self.assertEqual(client.get("/v1/models").status_code, 401)
                self.assertEqual(
                    client.get(
                        "/v1/models",
                        headers={"Authorization": "Bearer private-token"},
                    ).status_code,
                    200,
                )


if __name__ == "__main__":
    unittest.main()
