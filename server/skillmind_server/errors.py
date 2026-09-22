from __future__ import annotations

from dataclasses import dataclass


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, detail: str | None = None) -> None:
        self.status_code = status_code
        self.code = code
        self.detail = detail or code
        super().__init__(self.detail)


@dataclass(frozen=True)
class AuthUser:
    id: str
    token: str
