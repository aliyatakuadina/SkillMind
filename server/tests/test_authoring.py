from __future__ import annotations

import json

from skillmind_server.authoring import parse_json_object, sanitize_author_output
from skillmind_server.config_file import load_ai_config
from skillmind_server.settings import Settings
from skillmind_server.worker import process_claim


def test_quiz_output_drops_grading_fields():
    payload = parse_json_object(
        """```json
        {"kind":"quiz","passing_score":12,"attempt_limit":1,"questions":[
          {"type":"single_choice","prompt":"2+2","options":["3","4"],"correct_options":[1],"passing_score":99}
        ]}
        ```"""
    )
    result = sanitize_author_output("quiz", payload)
    dumped = json.dumps(result)
    assert "passing_score" not in dumped
    assert "attempt_limit" not in dumped
    assert result["questions"][0]["correct_options"] == [1]


def test_structure_keeps_only_editable_outline():
    result = sanitize_author_output(
        "course_structure",
        {
            "modules": [
                {
                    "title": "Модуль",
                    "passing_score": 10,
                    "lessons": [{"title": "Урок", "type": "quiz", "certificate": True}],
                }
            ]
        },
    )
    assert result["modules"][0]["lessons"][0]["type"] == "quiz"
    assert "passing_score" not in json.dumps(result)


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.params: dict[str, dict] = {}

    def rpc(self, name, params):
        self.calls.append(name)
        self.params[name] = params
        return self

    def execute(self):
        return type("Result", (), {"data": None})()


def test_worker_quiz_needs_review_without_grading_keys():
    settings = Settings(_env_file=None, gemini_api_key_1="gemini-secret-value", openai_api_key_1="x", litellm_api_key_1="y")
    config = load_ai_config(settings.config_path)

    def caller(_candidate, _prompt):
        return json.dumps(
            {
                "kind": "quiz",
                "passing_score": 15,
                "questions": [
                    {
                        "type": "single_choice",
                        "prompt": "Столица?",
                        "options": ["Астана", "Алматы"],
                        "correct_options": [0],
                        "explanation": "Астана",
                    }
                ],
            }
        )

    fake = _Recorder()
    process_claim(
        fake,
        {
            "job": {"id": "00000000-0000-4000-8000-000000000081", "task_type": "quiz"},
            "lease": {"lease_token": "token", "generation": 1},
            "input": {"title": "Урок", "content": "Казахстан"},
            "config": config.raw,
            "steps": [],
        },
        settings=settings,
        caller=caller,
    )
    assert fake.calls == ["ai_checkpoint_step", "ai_finish_job"]
    output = fake.params["ai_finish_job"]["p_output"]
    assert fake.params["ai_finish_job"]["p_status"] == "needs_review"
    assert "passing_score" not in json.dumps(output)
    assert output["questions"][0]["prompt"] == "Столица?"
