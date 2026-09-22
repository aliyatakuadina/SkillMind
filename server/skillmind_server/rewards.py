from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from skillmind_server.errors import ApiError, AuthUser

TZ = ZoneInfo("Asia/Qyzylorda")
XP = {
    "lesson_completed": 10,
    "quiz_passed": 25,
    "assignment_accepted": 40,
    "certificate_issued": 100,
}
ACHIEVEMENTS = {
    "first_lesson": "lesson_completed",
    "first_quiz": "quiz_passed",
    "first_certificate": "certificate_issued",
}


def week_start_on(day: date | None = None) -> date:
    current = day or datetime.now(TZ).date()
    return current - timedelta(days=current.isoweekday() - 1)


def level_for_xp(total: int) -> int:
    return 1 + max(0, int(total)) // 200


class RewardsService:
    def __init__(self, data) -> None:
        self.data = data

    def award(
        self,
        user: AuthUser,
        *,
        event_type: str,
        entity_id: str,
        course_id: str | None,
        historical: bool = False,
    ) -> dict[str, Any]:
        runtime = self.data.get_runtime()
        if not runtime.get("gamification_enabled"):
            raise ApiError(403, "AI_FEATURE_DISABLED")
        if event_type not in XP:
            raise ApiError(400, "AI_INVALID_INPUT")
        if not course_id:
            raise ApiError(400, "AI_INVALID_SCOPE")
        existing = self.data.find_xp(user.id, event_type, entity_id)
        if existing:
            return {"ledger": existing, "created": False, "total_xp": self.data.total_xp(user.id), "level": level_for_xp(self.data.total_xp(user.id))}
        row = self.data.insert_xp(
            {
                "id": str(uuid4()),
                "user_id": user.id,
                "course_id": course_id,
                "event_type": event_type,
                "entity_id": entity_id,
                "xp": XP[event_type],
                "historical": historical,
                "earned_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        self._achievements(user.id, event_type, row["id"])
        if not historical:
            self._weekly(user, course_id, event_type, row["xp"])
        total = self.data.total_xp(user.id)
        return {"ledger": row, "created": True, "total_xp": total, "level": level_for_xp(total)}

    def summary(self, user: AuthUser) -> dict[str, Any]:
        total = self.data.total_xp(user.id)
        return {
            "total_xp": total,
            "level": level_for_xp(total),
            "achievements": self.data.list_achievements(user.id),
            "preferences": self.data.get_preferences(user.id),
            "week_start": week_start_on().isoformat(),
        }

    def set_preferences(self, user: AuthUser, *, public_alias: str | None, weekly_goal_days: int | None, next_weekly_goal_days: int | None) -> dict[str, Any]:
        current = self.data.get_preferences(user.id) or {"user_id": user.id, "weekly_goal_days": 3}
        if public_alias is not None:
            alias = public_alias.strip()
            if alias and (len(alias) < 2 or len(alias) > 40 or "@" in alias):
                raise ApiError(400, "AI_INVALID_INPUT")
            current["public_alias"] = alias or None
        if weekly_goal_days is not None:
            if weekly_goal_days < 1 or weekly_goal_days > 7:
                raise ApiError(400, "AI_INVALID_INPUT")
            current["weekly_goal_days"] = weekly_goal_days
        if next_weekly_goal_days is not None:
            if next_weekly_goal_days < 1 or next_weekly_goal_days > 7:
                raise ApiError(400, "AI_INVALID_INPUT")
            current["next_weekly_goal_days"] = next_weekly_goal_days
            current["next_goal_effective_week"] = (week_start_on() + timedelta(days=7)).isoformat()
        return self.data.upsert_preferences(user.id, current)

    def join_ranking(self, user: AuthUser, course_id: str) -> dict[str, Any]:
        if self.data.is_course_author(user.token, course_id) or self.data.is_admin(user.token):
            raise ApiError(403, "AI_ACCESS_DENIED")
        if not self.data.can_use_course_chat(user.token, course_id):
            # reuse access gate for enrollment/published
            raise ApiError(403, "AI_ACCESS_DENIED")
        return self.data.join_ranking(user.id, course_id)

    def leave_ranking(self, user: AuthUser, course_id: str) -> dict[str, Any]:
        return self.data.leave_ranking(user.id, course_id)

    def leaderboard(self, user: AuthUser, course_id: str) -> dict[str, Any]:
        if not self.data.can_use_course_chat(user.token, course_id):
            raise ApiError(403, "AI_ACCESS_DENIED")
        start = week_start_on()
        rows = self.data.week_scores(course_id, start)
        board = []
        me = None
        for index, row in enumerate(rows, start=1):
            if not self.data.is_ranking_member(row["user_id"], course_id):
                continue
            alias = (self.data.get_preferences(row["user_id"]) or {}).get("public_alias") or "Участник"
            entry = {"rank": len(board) + 1, "alias": alias, "xp": row["xp"], "is_me": row["user_id"] == user.id}
            board.append(entry)
            if entry["is_me"]:
                me = entry
        return {"week_start": start.isoformat(), "leaders": board[:20], "me": me}

    def _achievements(self, user_id: str, event_type: str, ledger_id: str) -> None:
        for code, match in ACHIEVEMENTS.items():
            if match == event_type:
                self.data.grant_achievement(user_id, code, ledger_id)
        if event_type == "lesson_completed" and self.data.count_xp_events(user_id, "lesson_completed") >= 10:
            self.data.grant_achievement(user_id, "ten_lessons", ledger_id)

    def _weekly(self, user: AuthUser, course_id: str, event_type: str, xp: int) -> None:
        if event_type not in {"quiz_passed", "assignment_accepted"}:
            return
        if not self.data.is_ranking_member(user.id, course_id):
            return
        start = week_start_on()
        self.data.add_week_score(course_id, start, user.id, xp)
        prefs = self.data.get_preferences(user.id) or {"weekly_goal_days": 3}
        target = int(prefs.get("weekly_goal_days") or 3)
        self.data.mark_goal_day(user.id, start, datetime.now(TZ).date(), target)
