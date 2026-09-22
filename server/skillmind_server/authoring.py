from __future__ import annotations

import json
import re
from typing import Any

FORBIDDEN_GRADING_KEYS = {
    "passing_score",
    "attempt_limit",
    "certificate",
    "certificate_enabled",
    "auto_certificate",
}

LESSON_TYPES = {"video", "text", "pdf", "document", "quiz", "homework"}
QUESTION_TYPES = {"single_choice", "multiple_choice", "matching"}
AUTHOR_TASKS = {"course_structure", "lesson_summary", "quiz"}
PROFILE_BY_TASK = {
    "course_structure": "lecture",
    "lesson_summary": "lecture",
    "quiz": "quiz",
}

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


class AuthoringError(ValueError):
    def __init__(self, code: str, detail: str = "") -> None:
        self.code = code
        super().__init__(detail or code)


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = _FENCE.sub("", (text or "").strip())
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as error:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise AuthoringError("AI_INVALID_OUTPUT") from error
        try:
            payload = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as nested:
            raise AuthoringError("AI_INVALID_OUTPUT") from nested
    if not isinstance(payload, dict):
        raise AuthoringError("AI_INVALID_OUTPUT")
    return _strip_forbidden(payload)


def sanitize_author_output(task_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    clean = _strip_forbidden(payload)
    if task_type == "course_structure":
        return _structure(clean)
    if task_type == "lesson_summary":
        return _summary(clean)
    if task_type == "quiz":
        return _quiz(clean)
    raise AuthoringError("AI_INVALID_INPUT")


def prompt_for(task_type: str, payload: dict[str, Any]) -> str:
    if task_type == "course_structure":
        return (
            "Return JSON only with kind=course_structure and modules[]. "
            "Each module has title and lessons[]. Each lesson has title, type "
            "(text|video|quiz|homework|pdf|document), and description. "
            "Do not include passing_score, attempt_limit, or certificate fields. "
            f"Topic: {payload.get('topic','')}. Audience: {payload.get('audience','')}. "
            f"Goals: {payload.get('goals','')}. Duration: {payload.get('duration','')}."
        )
    if task_type == "lesson_summary":
        return (
            "Return JSON only with kind=lesson_summary, title, summary, and sections[{heading,body}]. "
            "Kazakh text must use Cyrillic. Do not change grading settings. "
            f"Lesson title: {payload.get('title','')}. Material:\n{payload.get('content','')}"
        )
    return (
        "Return JSON only with kind=quiz and questions[] of types single_choice, "
        "multiple_choice, or matching. Each question needs prompt, options or pairs, "
        "correct_options or pairs, explanation, points. Default 5 questions. "
        "Do not include passing_score, attempt_limit, or certificate fields. "
        f"Lesson title: {payload.get('title','')}. Material:\n{payload.get('content','')}"
    )


def _strip_forbidden(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_forbidden(item)
            for key, item in value.items()
            if str(key) not in FORBIDDEN_GRADING_KEYS
        }
    if isinstance(value, list):
        return [_strip_forbidden(item) for item in value]
    return value


def _structure(payload: dict[str, Any]) -> dict[str, Any]:
    modules = payload.get("modules") or []
    if not isinstance(modules, list) or not modules:
        raise AuthoringError("AI_INVALID_OUTPUT")
    result = []
    for module in modules[:20]:
        if not isinstance(module, dict):
            continue
        title = str(module.get("title") or "").strip()[:300]
        lessons = []
        for lesson in (module.get("lessons") or [])[:30]:
            if not isinstance(lesson, dict):
                continue
            lesson_title = str(lesson.get("title") or "").strip()[:300]
            lesson_type = str(lesson.get("type") or "text")
            if lesson_type not in LESSON_TYPES:
                lesson_type = "text"
            if lesson_title:
                lessons.append(
                    {
                        "title": lesson_title,
                        "type": lesson_type,
                        "description": str(lesson.get("description") or "").strip()[:2000],
                    }
                )
        if title and lessons:
            result.append({"title": title, "lessons": lessons})
    if not result:
        raise AuthoringError("AI_INVALID_OUTPUT")
    return {"kind": "course_structure", "modules": result}


def _summary(payload: dict[str, Any]) -> dict[str, Any]:
    summary = str(payload.get("summary") or payload.get("content") or "").strip()
    if len(summary) < 3:
        raise AuthoringError("AI_INVALID_OUTPUT")
    sections = []
    for section in (payload.get("sections") or [])[:20]:
        if not isinstance(section, dict):
            continue
        heading = str(section.get("heading") or "").strip()[:200]
        body = str(section.get("body") or "").strip()[:4000]
        if heading or body:
            sections.append({"heading": heading, "body": body})
    return {
        "kind": "lesson_summary",
        "title": str(payload.get("title") or "").strip()[:300],
        "summary": summary[:8000],
        "sections": sections,
    }


def _quiz(payload: dict[str, Any]) -> dict[str, Any]:
    questions = payload.get("questions") or []
    if not isinstance(questions, list) or not questions:
        raise AuthoringError("AI_INVALID_OUTPUT")
    result = []
    for question in questions[:10]:
        if not isinstance(question, dict):
            continue
        qtype = str(question.get("type") or "single_choice")
        if qtype not in QUESTION_TYPES:
            continue
        prompt = str(question.get("prompt") or "").strip()[:1000]
        if not prompt:
            continue
        item: dict[str, Any] = {
            "type": qtype,
            "prompt": prompt,
            "explanation": str(question.get("explanation") or "").strip()[:2000],
            "points": 1,
        }
        try:
            points = int(question.get("points") or 1)
            if 1 <= points <= 10:
                item["points"] = points
        except (TypeError, ValueError):
            pass
        if qtype == "matching":
            pairs = []
            for pair in (question.get("pairs") or [])[:8]:
                if not isinstance(pair, dict):
                    continue
                left = str(pair.get("left") or "").strip()[:200]
                right = str(pair.get("right") or "").strip()[:200]
                if left and right:
                    pairs.append({"left": left, "right": right})
            if len(pairs) < 2:
                continue
            item["pairs"] = pairs
        else:
            options = [str(option).strip()[:200] for option in (question.get("options") or []) if str(option).strip()]
            if len(options) < 2:
                continue
            item["options"] = options[:8]
            raw_correct = question.get("correct_options")
            if qtype == "single_choice":
                index = 0
                if isinstance(raw_correct, list) and raw_correct:
                    try:
                        index = int(raw_correct[0])
                    except (TypeError, ValueError):
                        index = 0
                elif raw_correct is not None:
                    try:
                        index = int(raw_correct)
                    except (TypeError, ValueError):
                        index = 0
                item["correct_options"] = [index if 0 <= index < len(item["options"]) else 0]
            else:
                indexes = []
                if isinstance(raw_correct, list):
                    for value in raw_correct:
                        try:
                            index = int(value)
                        except (TypeError, ValueError):
                            continue
                        if 0 <= index < len(item["options"]) and index not in indexes:
                            indexes.append(index)
                item["correct_options"] = indexes or [0]
        result.append(item)
    if not result:
        raise AuthoringError("AI_INVALID_OUTPUT")
    return {"kind": "quiz", "questions": result}
