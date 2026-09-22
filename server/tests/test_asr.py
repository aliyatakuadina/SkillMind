from __future__ import annotations

import json
import subprocess
from pathlib import Path

import httpx

from skillmind_server.adapters import Candidate, transcribe_gemini, transcribe_openai
from skillmind_server.asr import absolute_cues, gemini_words, plan_chunks, probe_media, split_long_cues, whisper_cues, words_to_cues
from skillmind_server.slides import extract_jpeg, frame_times, notes_from_model
from skillmind_server.video_bundle import lock_cue_timeline, sanitize_video_bundle
from test_video_bundle import sample_languages
from skillmind_server.errors import ApiError


def test_plan_chunks_overlap_every_ten_minutes():
    assert plan_chunks(600) == [{"index": 0, "start": 0.0, "end": 600.0}]
    chunks = plan_chunks(601)
    assert chunks[0]["end"] == 600
    assert chunks[1]["start"] == 598
    assert chunks[1]["end"] == 601
    assert plan_chunks(0) == []


def test_overlap_is_kept_only_in_the_first_chunk():
    first = absolute_cues(
        {"index": 0, "start": 0, "end": 600},
        [{"start": 599, "end": 600, "text": "конец"}],
    )
    second = absolute_cues(
        {"index": 1, "start": 598, "end": 700},
        [
            {"start": 0.4, "end": 1.0, "text": "повтор"},
            {"start": 2.5, "end": 4.0, "text": "дальше"},
        ],
    )
    assert first[0]["text"] == "конец"
    assert [item["text"] for item in second] == ["дальше"]
    assert second[0]["start"] == 600.5


def test_gemini_words_become_cues_on_a_pause():
    payload = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "audioTranscription": {
                                "words": [
                                    {"word": "Hello", "startOffset": "0.100s", "endOffset": "0.450s"},
                                    {"word": "world", "startOffset": "0.500s", "endOffset": "0.850s"},
                                    {"word": "снова", "startOffset": "2.000s", "endOffset": "2.400s"},
                                ]
                            }
                        }
                    ]
                }
            }
        ]
    }
    cues = words_to_cues(gemini_words(payload))
    assert cues[0]["text"] == "Hello world"
    assert cues[1]["text"] == "снова"
    assert cues[1]["start"] == 2.0


def test_probe_rejects_silence_damage_and_missing_ffmpeg():
    def silent(_cmd, **_kwargs):
        return subprocess.CompletedProcess(
            [],
            0,
            stdout=json.dumps({"streams": [{"codec_type": "video"}], "format": {"duration": "12"}}),
            stderr="",
        )

    try:
        probe_media("lecture.mp4", runner=silent)
        raise AssertionError("expected missing audio")
    except ApiError as error:
        assert error.code == "MEDIA_AUDIO_MISSING"

    def broken(_cmd, **_kwargs):
        return subprocess.CompletedProcess([], 1, stdout="", stderr="invalid")

    try:
        probe_media("lecture.mp4", runner=broken)
        raise AssertionError("expected unreadable")
    except ApiError as error:
        assert error.code == "MEDIA_UNREADABLE"

    def too_long(_cmd, **_kwargs):
        return subprocess.CompletedProcess(
            [],
            0,
            stdout=json.dumps({"streams": [{"codec_type": "audio"}], "format": {"duration": "7201"}}),
            stderr="",
        )

    try:
        probe_media("lecture.mp4", runner=too_long)
        raise AssertionError("expected duration")
    except ApiError as error:
        assert error.code == "MEDIA_DURATION_UNSUPPORTED"

    def missing(_cmd, **_kwargs):
        raise FileNotFoundError("ffmpeg")

    try:
        probe_media("lecture.mp4", runner=missing)
        raise AssertionError("expected ffmpeg")
    except ApiError as error:
        assert error.code == "MEDIA_FFMPEG_UNAVAILABLE"


def test_gemini_transcribe_requests_word_timestamps(monkeypatch):
    captured = {}

    class Response:
        status_code = 200
        headers: dict = {}

        def json(self):
            return {"candidates": []}

    def post(url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs["json"]
        return Response()

    monkeypatch.setattr(httpx, "post", post)
    transcribe_gemini("https://generativelanguage.googleapis.com", "secret", "gemini-3.5-transcribe", b"abc", "audio/mpeg")
    assert captured["url"].endswith("/models/gemini-3.5-transcribe:generateContent")
    assert captured["json"]["generationConfig"]["audioTranscriptionConfig"]["wordTimestamp"] is True
    assert captured["json"]["contents"][0]["parts"][0]["inlineData"]["mimeType"] == "audio/mpeg"


def test_whisper_uses_verbose_segments(monkeypatch):
    captured = {}

    class Response:
        status_code = 200
        headers: dict = {}

        def json(self):
            return {"segments": [{"start": 0.2, "end": 1.4, "text": " Сәлем"}]}

    def post(url, **kwargs):
        captured["url"] = url
        captured["data"] = kwargs["data"]
        return Response()

    monkeypatch.setattr(httpx, "post", post)
    candidate = Candidate("openai-asr", "openai", "https://api.openai.com/v1", "OPENAI_API_KEY_1", "secret", None, "whisper-1")
    payload = transcribe_openai(candidate.base_url, candidate.api_key, candidate.model_id, b"abc", "audio/mpeg")
    assert captured["url"].endswith("/audio/transcriptions")
    assert captured["data"]["response_format"] == "verbose_json"
    assert payload["segments"][0]["text"].strip() == "Сәлем"


def test_frame_times_cover_the_lecture_without_the_first_hour_only():
    assert frame_times(20) == [1.0]
    assert len(frame_times(600)) == 10
    assert frame_times(600)[0] == 30
    assert len(frame_times(7200)) == 12
    assert frame_times(0) == []


def test_slide_notes_keep_visible_text_only():
    notes = notes_from_model('{"observations":[{"time":"12.5","text":"  формула  "},{"time":-1,"text":"нет"}]}')
    assert notes == [{"time": 12.5, "text": "формула"}]


def test_extract_jpeg_reads_the_frame_ffmpeg_wrote():
    def runner(cmd, **_kwargs):
        Path(cmd[-1]).write_bytes(b"jpeg-bytes")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    assert extract_jpeg("lecture.mp4", 12.5, runner=runner) == b"jpeg-bytes"


def test_whisper_marks_uncertain_segments_and_timeline_keeps_them():
    cues = whisper_cues(
        {
            "segments": [
                {"start": 0, "end": 1, "text": "ясно", "avg_logprob": -0.2, "no_speech_prob": 0.1},
                {"start": 1, "end": 2, "text": "шум", "avg_logprob": -1.4},
            ]
        }
    )
    assert "uncertain" not in cues[0]
    assert cues[1]["uncertain"] is True
    shifted = absolute_cues({"index": 0, "start": 10, "end": 20}, cues)
    assert shifted[1]["start"] == 11
    assert shifted[1]["uncertain"] is True
    languages = sample_languages()
    languages["ru"]["cues"][0]["uncertain"] = True
    sanitized = sanitize_video_bundle({"languages": languages}, source="file", duration_seconds=60)
    assert sanitized["languages"]["ru"]["cues"][0]["uncertain"] is True
    assert "uncertain" not in sanitized["languages"]["kk"]["cues"][0]
    locked = lock_cue_timeline(sanitized, [{"start": 1.25, "end": 3.5, "text": "Привет", "uncertain": True}])
    assert locked["languages"]["en"]["cues"][0]["uncertain"] is True
    assert locked["languages"]["en"]["cues"][0]["start"] == 1.25


def test_split_long_cues_keeps_span_and_uncertain():
    long = " ".join(["слово"] * 40)
    cues = split_long_cues([{"start": 0, "end": 10, "text": long, "uncertain": True}])
    assert len(cues) > 1
    assert cues[0]["start"] == 0
    assert cues[-1]["end"] == 10
    assert all(item["uncertain"] is True for item in cues)
    assert all(len(item["text"]) <= 120 for item in cues)
    assert " ".join(item["text"] for item in cues) == long
    short = split_long_cues([{"start": 1, "end": 2, "text": "коротко"}])
    assert short == [{"start": 1.0, "end": 2.0, "text": "коротко"}]
