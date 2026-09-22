from __future__ import annotations

import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import psycopg2
from psycopg2.extras import Json, RealDictCursor

from skillmind_server.errors import ApiError
from skillmind_server.settings import Settings

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PARENT_FK = {
    ("courses", "author"): "author_id",
    ("assignment_submissions", "user"): "user_id",
    ("assignment_submissions", "assignment"): "assignment_id",
    ("assignments", "lesson"): "lesson_id",
    ("lessons", "module"): "module_id",
    ("modules", "course"): "course_id",
    ("enrollments", "course"): "course_id",
    ("certificates", "course"): "course_id",
}
CHILD_FK = {
    "modules": "course_id",
    "lessons": "module_id",
    "lesson_items": "lesson_id",
    "quizzes": "lesson_id",
    "quiz_questions": "quiz_id",
    "enrollments": "course_id",
    "submission_files": "submission_id",
    "assignments": "lesson_id",
}
SINGULAR = {"author", "user", "assignment", "lesson", "module", "course", "quizzes"}
FK_PARENT_COLUMN = {
    "courses_author_id_fkey": "author_id",
    "assignment_submissions_user_id_fkey": "user_id",
}


def ident(value: str) -> str:
    if not IDENT.match(value or ""):
        raise ApiError(400, "AI_INVALID_INPUT")
    return value


def connect(settings: Settings):
    return psycopg2.connect(settings.postgres_dsn)


def json_ready(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    return value


class PgResult:
    def __init__(self, data: Any) -> None:
        self.data = data


class PgQuery:
    def __init__(self, client: PgClient, table: str) -> None:
        self.client = client
        self.table = ident(table)
        self.operation = "select"
        self.columns = "*"
        self.filters: list[tuple[str, str, Any]] = []
        self.ordering: list[tuple[str, bool]] = []
        self.row_limit: int | None = None
        self.values: Any = None
        self.conflict: str | None = None

    def select(self, columns: str = "*") -> PgQuery:
        self.operation = "select"
        self.columns = columns
        return self

    def eq(self, column: str, value: Any) -> PgQuery:
        self.filters.append(("eq", ident(column), value))
        return self

    def order(self, column: str, desc: bool = False) -> PgQuery:
        self.ordering.append((ident(column), desc))
        return self

    def limit(self, count: int) -> PgQuery:
        self.row_limit = count
        return self

    def insert(self, values: dict[str, Any] | list[dict[str, Any]]) -> PgQuery:
        self.operation = "insert"
        self.values = values
        return self

    def update(self, values: dict[str, Any]) -> PgQuery:
        self.operation = "update"
        self.values = values
        return self

    def delete(self) -> PgQuery:
        self.operation = "delete"
        return self

    def upsert(self, values: dict[str, Any] | list[dict[str, Any]], on_conflict: str | None = None) -> PgQuery:
        self.operation = "upsert"
        self.values = values
        self.conflict = on_conflict
        return self

    def execute(self) -> PgResult:
        return PgResult(self.client._execute_table(self))


class PgRpc:
    def __init__(self, client: PgClient, name: str, args: dict[str, Any] | None) -> None:
        self.client = client
        self.name = ident(name)
        self.args = args or {}

    def execute(self) -> PgResult:
        return PgResult(self.client._execute_rpc(self.name, self.args))


class PgClient:
    def __init__(self, settings: Settings, *, user_id: str | None = None, role: str | None = None) -> None:
        self.settings = settings
        self.user_id = user_id
        self.role = role

    def table(self, name: str) -> PgQuery:
        return PgQuery(self, name)

    def rpc(self, name: str, args: dict[str, Any] | None = None) -> PgRpc:
        return PgRpc(self, name, args)

    def _connection(self):
        connection = connect(self.settings)
        connection.autocommit = False
        return connection

    def _prepare(self, cursor) -> None:
        if self.user_id:
            cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (self.user_id,))
            cursor.execute("select set_config('request.jwt.claim.role', 'authenticated', true)")
        if self.role in {"anon", "authenticated", "service_role"}:
            cursor.execute(f"set local role {self.role}")

    def _execute_table(self, query: PgQuery) -> list[dict[str, Any]]:
        with self._connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                self._prepare(cursor)
                rows = _run_table(cursor, query)
            connection.commit()
        return rows

    def _execute_rpc(self, name: str, args: dict[str, Any]) -> Any:
        with self._connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                self._prepare(cursor)
                value = _run_rpc(cursor, name, args)
            connection.commit()
        return value


def service_client(settings: Settings) -> PgClient:
    return PgClient(settings)


def user_client_factory(settings: Settings):
    from skillmind_server.auth import decode_access_token

    def factory(token: str) -> PgClient:
        payload = decode_access_token(token, settings)
        user_id = str(payload.get("sub") or "")
        if not user_id:
            raise ApiError(401, "AI_AUTH_REQUIRED")
        return PgClient(settings, user_id=user_id, role="authenticated")

    return factory


def run_browser_query(settings: Settings, user_id: str | None, body: dict[str, Any]) -> Any:
    role = "authenticated" if user_id else "anon"
    client = PgClient(settings, user_id=user_id, role=role)
    table = ident(str(body.get("table") or ""))
    operation = str(body.get("op") or "select")
    query = PgQuery(client, table)
    query.operation = operation
    query.columns = str(body.get("select") or "*")
    query.filters = [(item["op"], ident(item["column"]), item.get("value")) for item in body.get("filters") or []]
    query.ordering = [(ident(item["column"]), not item.get("ascending", True)) for item in body.get("order") or []]
    query.values = body.get("values")
    query.conflict = body.get("on_conflict")
    mode = body.get("mode")
    try:
        rows = _execute_browser(client, query)
    except psycopg2.Error as error:
        raise ApiError(400, getattr(error, "pgerror", None) and error.diag.message_primary or "AI_INVALID_INPUT") from error
    rows = json_ready(rows)
    if mode == "single":
        if len(rows) != 1:
            raise ApiError(406, "AI_ROW_COUNT")
        return rows[0]
    if mode == "maybe":
        if len(rows) > 1:
            raise ApiError(406, "AI_ROW_COUNT")
        return rows[0] if rows else None
    return rows


def run_browser_rpc(settings: Settings, user_id: str | None, name: str, args: dict[str, Any], mode: str | None) -> Any:
    role = "authenticated" if user_id else "anon"
    client = PgClient(settings, user_id=user_id, role=role)
    try:
        value = client._execute_rpc(ident(name), args)
    except psycopg2.Error as error:
        message = error.diag.message_primary if getattr(error, "diag", None) else "AI_INVALID_INPUT"
        raise ApiError(400, message or "AI_INVALID_INPUT") from error
    value = json_ready(value)
    if mode == "maybe":
        if isinstance(value, list):
            if len(value) > 1:
                raise ApiError(406, "AI_ROW_COUNT")
            return value[0] if value else None
        return value
    return value


def _execute_browser(client: PgClient, query: PgQuery) -> list[dict[str, Any]]:
    if query.operation == "select" and "(" in query.columns:
        return _select_embedded(client, query)
    return client._execute_table(query)


def _select_embedded(client: PgClient, query: PgQuery) -> list[dict[str, Any]]:
    fields = _parse_select(query.columns)
    columns = {field["name"] for field in fields if field["kind"] == "column"}
    columns.add("id")
    for field in fields:
        if field["kind"] == "column":
            continue
        parent_column = PARENT_FK.get((query.table, field["alias"])) or FK_PARENT_COLUMN.get(field.get("fk") or "")
        if parent_column:
            columns.add(parent_column)
    plain = PgQuery(client, query.table)
    plain.columns = ",".join(columns)
    plain.filters = query.filters
    plain.ordering = query.ordering
    plain.row_limit = query.row_limit
    rows = client._execute_table(plain)
    for row in rows:
        for field in fields:
            if field["kind"] == "column":
                continue
            row[field["alias"]] = _load_embed(client, query.table, row, field)
    return rows


def _load_embed(client: PgClient, parent_table: str, parent: dict[str, Any], field: dict[str, Any]) -> Any:
    parent_id = parent.get("id")
    if field["kind"] == "count":
        child = field["table"] if field["table"] in CHILD_FK else field["alias"]
        fk = CHILD_FK[child]
        counted = PgQuery(client, child)
        counted.columns = "id"
        counted.filters = [("eq", fk, parent_id)]
        return [{"count": len(client._execute_table(counted))}]
    child_table = field["table"]
    parent_column = PARENT_FK.get((parent_table, field["alias"])) or FK_PARENT_COLUMN.get(field.get("fk") or "")
    if parent_column:
        child_query = PgQuery(client, child_table)
        child_query.columns = _inner_select(field)
        child_query.filters = [("eq", "id", parent.get(parent_column))]
        rows = _execute_browser(client, child_query)
    else:
        fk = CHILD_FK[child_table]
        child_query = PgQuery(client, child_table)
        child_query.columns = _inner_select(field)
        child_query.filters = [("eq", fk, parent_id)]
        rows = _execute_browser(client, child_query)
    if field["alias"] in SINGULAR or child_table in SINGULAR:
        return rows[0] if rows else None
    return rows


def _inner_select(field: dict[str, Any]) -> str:
    parts = []
    for child in field["fields"]:
        if child["kind"] == "column":
            parts.append(child["name"])
        elif child["kind"] == "count":
            parts.append(f"{child['alias']}(count)")
        else:
            head = child["alias"] if child["alias"] == child["table"] else f"{child['alias']}:{child['table']}"
            if child.get("fk"):
                head = f"{head}!{child['fk']}"
            parts.append(f"{head}({_inner_select(child)})")
    return ",".join(parts) or "id"


def _parse_select(expression: str) -> list[dict[str, Any]]:
    return [_parse_field(part) for part in _split_top(expression)]


def _parse_field(token: str) -> dict[str, Any]:
    token = token.strip()
    if "(" not in token:
        return {"kind": "column", "name": ident(token)}
    head, inner = token.split("(", 1)
    inner = inner[:-1] if inner.endswith(")") else inner
    alias = head.strip()
    table = alias
    fk = None
    if ":" in alias:
        alias, table = alias.split(":", 1)
    if "!" in table:
        table, fk = table.split("!", 1)
    alias = ident(alias)
    table = ident(table)
    if fk:
        ident(fk)
    if inner.strip() == "count":
        return {"kind": "count", "alias": alias, "table": table, "fk": fk}
    return {
        "kind": "embed",
        "alias": alias,
        "table": table,
        "fk": fk,
        "fields": _parse_select(inner),
    }


def _split_top(expression: str) -> list[str]:
    parts: list[str] = []
    buffer: list[str] = []
    depth = 0
    for char in expression:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(buffer).strip())
            buffer = []
        else:
            buffer.append(char)
    if buffer:
        parts.append("".join(buffer).strip())
    return [part for part in parts if part]


def _run_table(cursor, query: PgQuery) -> list[dict[str, Any]]:
    if query.operation == "select":
        columns = "*" if query.columns.strip() == "*" else ", ".join(ident(part.strip()) for part in query.columns.split(","))
        where, params = _where(query.table, query.filters, cursor)
        order = ""
        if query.ordering:
            order = " order by " + ", ".join(f"{column} {'desc' if desc else 'asc'}" for column, desc in query.ordering)
        limit = ""
        if query.row_limit is not None:
            limit = " limit %s"
            params = [*params, query.row_limit]
        cursor.execute(f"select {columns} from public.{query.table}{where}{order}{limit}", params)
        return [_record(row) for row in cursor.fetchall()]
    rows = query.values if isinstance(query.values, list) else [query.values]
    if query.operation == "insert":
        written = [_insert(cursor, query.table, row, None) for row in rows]
        return written
    if query.operation == "upsert":
        conflict = [ident(part.strip()) for part in (query.conflict or "id").split(",")]
        return [_insert(cursor, query.table, row, conflict) for row in rows]
    if query.operation == "update":
        assignments, params = _assignments(cursor, query.table, query.values)
        where, where_params = _where(query.table, query.filters, cursor)
        cursor.execute(
            f"update public.{query.table} set {assignments}{where} returning *",
            [*params, *where_params],
        )
        return [_record(row) for row in cursor.fetchall()]
    if query.operation == "delete":
        where, params = _where(query.table, query.filters, cursor)
        cursor.execute(f"delete from public.{query.table}{where} returning *", params)
        return [_record(row) for row in cursor.fetchall()]
    raise ApiError(400, "AI_INVALID_INPUT")


def _insert(cursor, table: str, row: dict[str, Any], conflict: list[str] | None) -> dict[str, Any]:
    columns = [ident(key) for key in row]
    values, params = _value_placeholders(cursor, table, row)
    sql = f"insert into public.{table} ({', '.join(columns)}) values ({', '.join(values)})"
    if conflict:
        updates = ", ".join(f"{column} = excluded.{column}" for column in columns if column not in conflict)
        sql += f" on conflict ({', '.join(conflict)}) do update set {updates}"
    cursor.execute(sql + " returning *", params)
    return _record(cursor.fetchone())


def _where(table: str, filters: list[tuple[str, str, Any]], cursor) -> tuple[str, list[Any]]:
    if not filters:
        return "", []
    clauses = []
    params: list[Any] = []
    for op, column, value in filters:
        if op == "in":
            if not value:
                clauses.append("false")
                continue
            pg_type = _column_type(cursor, table, column)
            clauses.append(f"{column} = any(%s::{pg_type}[])")
            params.append(list(value))
            continue
        if op != "eq":
            raise ApiError(400, "AI_INVALID_INPUT")
        placeholder, adapted = _adapt(cursor, table, column, value)
        clauses.append(f"{column} = {placeholder}")
        params.append(adapted)
    return " where " + " and ".join(clauses), params


def _assignments(cursor, table: str, values: dict[str, Any]) -> tuple[str, list[Any]]:
    parts = []
    params = []
    for key, value in values.items():
        column = ident(key)
        placeholder, adapted = _adapt(cursor, table, column, value)
        parts.append(f"{column} = {placeholder}")
        params.append(adapted)
    return ", ".join(parts), params


def _value_placeholders(cursor, table: str, row: dict[str, Any]) -> tuple[list[str], list[Any]]:
    placeholders = []
    params = []
    for key, value in row.items():
        placeholder, adapted = _adapt(cursor, table, ident(key), value)
        placeholders.append(placeholder)
        params.append(adapted)
    return placeholders, params


def _column_type(cursor, table: str, column: str) -> str:
    cursor.execute(
        """
        select format_type(a.atttypid, a.atttypmod)
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = %s and a.attname = %s and a.attnum > 0
        """,
        (table, column),
    )
    row = cursor.fetchone()
    if not row:
        raise ApiError(400, "AI_INVALID_INPUT")
    return row["format_type"] if isinstance(row, dict) else row[0]


def _adapt(cursor, table: str, column: str, value: Any) -> tuple[str, Any]:
    pg_type = _column_type(cursor, table, column)
    if pg_type == "extensions.vector" and isinstance(value, list):
        return "%s::extensions.vector", "[" + ",".join(str(float(item)) for item in value) + "]"
    if pg_type in {"jsonb", "json"}:
        return f"%s::{pg_type}", Json(value)
    if pg_type.endswith("[]") and isinstance(value, list):
        return f"%s::{pg_type}", value
    if value is None:
        return f"%s::{pg_type}", None
    return f"%s::{pg_type}", value


def _run_rpc(cursor, name: str, args: dict[str, Any]) -> Any:
    cursor.execute(
        """
        select p.proretset, format_type(p.prorettype, null) as return_type,
               p.proargnames, p.proargtypes::oid[] as argtypes
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = %s
        order by p.oid
        limit 1
        """,
        (name,),
    )
    meta = cursor.fetchone()
    if not meta:
        raise ApiError(404, "AI_INVALID_INPUT")
    names = meta["proargnames"] or []
    argtypes = meta["argtypes"] or []
    typed = {}
    for arg_name, arg_type in zip(names, argtypes):
        cursor.execute("select format_type(%s, null) as type_name", (arg_type,))
        typed[arg_name] = cursor.fetchone()["type_name"]
    pieces = []
    params: list[Any] = []
    for key, value in args.items():
        arg_name = ident(key)
        pg_type = typed.get(arg_name)
        if not pg_type:
            raise ApiError(400, "AI_INVALID_INPUT")
        adapted = value
        if pg_type in {"jsonb", "json"}:
            adapted = Json(value)
        elif pg_type == "extensions.vector" and isinstance(value, list):
            adapted = "[" + ",".join(str(float(item)) for item in value) + "]"
        pieces.append(f"{arg_name} := %s::{pg_type}")
        params.append(adapted)
    call = f"public.{name}({', '.join(pieces)})"
    return_type = meta["return_type"]
    if return_type == "void":
        from psycopg2.extensions import adapt

        literals = []
        for key, value in args.items():
            arg_name = ident(key)
            pg_type = typed[arg_name]
            adapted = Json(value) if pg_type in {"jsonb", "json"} else value
            literals.append(f"{arg_name} := {adapt(adapted).getquoted().decode()}::{pg_type}")
        cursor.execute(f"DO $body$ BEGIN PERFORM public.{name}({', '.join(literals)}); END $body$;")
        return None
    if meta["proretset"]:
        cursor.execute(f"select to_jsonb(t) as row from {call} t", params)
        return [row["row"] for row in cursor.fetchall()]
    if return_type in {"jsonb", "json"}:
        cursor.execute(f"select {call} as row", params)
        found = cursor.fetchone()
        return found["row"] if found else None
    cursor.execute(f"select to_jsonb({call}) as row", params)
    found = cursor.fetchone()
    return found["row"] if found else None


class LocalData:
    def __init__(self, settings: Settings) -> None:
        from skillmind_server.data import SupabaseData

        self.settings = settings
        self.inner = SupabaseData(service_client(settings), user_client_factory(settings))

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    def can_use_course_chat(self, token: str, course_id: str) -> bool:
        user = user_client_factory(self.settings)(token)
        with connect(self.settings) as connection:
            with connection.cursor() as cursor:
                cursor.execute("select set_config('request.jwt.claim.sub', %s, true)", (user.user_id,))
                cursor.execute("select private.can_use_course_chat(%s::uuid)", (course_id,))
                row = cursor.fetchone()
            connection.commit()
        return bool(row and row[0])

    def create_index_version(self, record: dict[str, Any]) -> dict[str, Any]:
        return self.inner.service.table("course_index_versions").insert(record).execute().data[0]

    def replace_course_chunks(self, index_version_id: str, chunks: list[dict[str, Any]]) -> None:
        self.inner.service.table("course_chunks").delete().eq("index_version_id", index_version_id).execute()
        if chunks:
            self.inner.service.table("course_chunks").insert(chunks).execute()

    def activate_index_version(self, index_version_id: str, course_id: str) -> dict[str, Any]:
        rows = self.inner.service.table("course_index_versions").select("id").eq("course_id", course_id).eq("status", "active").execute().data or []
        for row in rows:
            self.inner.service.table("course_index_versions").update({"status": "retired"}).eq("id", row["id"]).execute()
        return self.inner.service.table("course_index_versions").update({"status": "active"}).eq("id", index_version_id).execute().data[0]

    def active_index_version(self, course_id: str) -> dict[str, Any] | None:
        rows = self.inner.service.table("course_index_versions").select("*").eq("course_id", course_id).eq("status", "active").limit(1).execute().data or []
        return rows[0] if rows else None

    def list_course_chunks(self, index_version_id: str, *, language: str | None = None) -> list[dict[str, Any]]:
        query = self.inner.service.table("course_chunks").select("*").eq("index_version_id", index_version_id)
        if language:
            query = query.eq("language", language)
        return query.execute().data or []

    def create_chat_thread(self, record: dict[str, Any]) -> dict[str, Any]:
        return self.inner.service.table("chat_threads").insert(record).execute().data[0]

    def get_chat_thread(self, thread_id: str) -> dict[str, Any] | None:
        rows = self.inner.service.table("chat_threads").select("*").eq("id", thread_id).limit(1).execute().data or []
        return rows[0] if rows else None

    def create_chat_message(self, record: dict[str, Any]) -> dict[str, Any]:
        return self.inner.service.table("chat_messages").insert(record).execute().data[0]

    def find_chat_message(self, thread_id: str, idempotency_key: str, role: str) -> dict[str, Any] | None:
        rows = (
            self.inner.service.table("chat_messages")
            .select("*")
            .eq("thread_id", thread_id)
            .eq("idempotency_key", idempotency_key)
            .eq("role", role)
            .limit(1)
            .execute()
            .data
            or []
        )
        return rows[0] if rows else None

    def list_chat_messages(self, thread_id: str) -> list[dict[str, Any]]:
        return self.inner.service.table("chat_messages").select("*").eq("thread_id", thread_id).order("created_at").execute().data or []

    def find_xp(self, user_id: str, event_type: str, entity_id: str) -> dict[str, Any] | None:
        rows = (
            self.inner.service.table("xp_ledger")
            .select("*")
            .eq("user_id", user_id)
            .eq("event_type", event_type)
            .eq("entity_id", entity_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        return rows[0] if rows else None

    def insert_xp(self, record: dict[str, Any]) -> dict[str, Any]:
        return self.inner.service.table("xp_ledger").insert(record).execute().data[0]

    def total_xp(self, user_id: str) -> int:
        rows = self.inner.service.table("xp_ledger").select("xp").eq("user_id", user_id).execute().data or []
        return sum(int(row["xp"]) for row in rows)

    def count_xp_events(self, user_id: str, event_type: str) -> int:
        rows = self.inner.service.table("xp_ledger").select("id").eq("user_id", user_id).eq("event_type", event_type).execute().data or []
        return len(rows)

    def grant_achievement(self, user_id: str, code: str, ledger_id: str) -> None:
        existing = (
            self.inner.service.table("user_achievements").select("user_id").eq("user_id", user_id).eq("achievement_code", code).limit(1).execute().data
            or []
        )
        if existing:
            return
        self.inner.service.table("user_achievements").insert(
            {"user_id": user_id, "achievement_code": code, "source_ledger_id": ledger_id}
        ).execute()

    def list_achievements(self, user_id: str) -> list[dict[str, Any]]:
        return self.inner.service.table("user_achievements").select("*").eq("user_id", user_id).execute().data or []

    def get_preferences(self, user_id: str) -> dict[str, Any] | None:
        rows = self.inner.service.table("gamification_preferences").select("*").eq("user_id", user_id).limit(1).execute().data or []
        return rows[0] if rows else None

    def upsert_preferences(self, user_id: str, record: dict[str, Any]) -> dict[str, Any]:
        return self.inner.service.table("gamification_preferences").upsert({**record, "user_id": user_id}, on_conflict="user_id").execute().data[0]

    def join_ranking(self, user_id: str, course_id: str) -> dict[str, Any]:
        return self.inner.service.table("course_ranking_memberships").upsert(
            {"user_id": user_id, "course_id": course_id, "left_at": None},
            on_conflict="user_id,course_id",
        ).execute().data[0]

    def leave_ranking(self, user_id: str, course_id: str) -> dict[str, Any]:
        return self.inner.service.table("course_ranking_memberships").update(
            {"left_at": datetime.now().isoformat()}
        ).eq("user_id", user_id).eq("course_id", course_id).execute().data[0]

    def is_ranking_member(self, user_id: str, course_id: str) -> bool:
        rows = self.inner.service.table("course_ranking_memberships").select("left_at").eq("user_id", user_id).eq("course_id", course_id).limit(1).execute().data or []
        return bool(rows and not rows[0].get("left_at"))

    def add_week_score(self, course_id: str, week_start, user_id: str, xp: int) -> None:
        key = str(week_start)
        rows = (
            self.inner.service.table("course_weekly_scores")
            .select("score")
            .eq("course_id", course_id)
            .eq("week_start", key)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if rows:
            self.inner.service.table("course_weekly_scores").update({"score": int(rows[0]["score"]) + int(xp)}).eq("course_id", course_id).eq("week_start", key).eq("user_id", user_id).execute()
        else:
            self.inner.service.table("course_weekly_scores").insert(
                {"course_id": course_id, "week_start": key, "user_id": user_id, "score": xp}
            ).execute()

    def week_scores(self, course_id: str, week_start) -> list[dict[str, Any]]:
        rows = (
            self.inner.service.table("course_weekly_scores")
            .select("*")
            .eq("course_id", course_id)
            .eq("week_start", str(week_start))
            .execute()
            .data
            or []
        )
        rows.sort(key=lambda item: (-int(item["score"]), item["user_id"]))
        return [{"user_id": row["user_id"], "xp": row["score"]} for row in rows]

    def mark_goal_day(self, user_id: str, week_start, day, target: int) -> None:
        start = str(week_start)
        rows = self.inner.service.table("weekly_learning_goals").select("*").eq("user_id", user_id).eq("week_start", start).limit(1).execute().data or []
        current = rows[0] if rows else {"user_id": user_id, "week_start": start, "target_days": target, "active_days": []}
        days = list(current.get("active_days") or [])
        stamp = str(day)
        if stamp not in days:
            days.append(stamp)
        payload = {"user_id": user_id, "week_start": start, "target_days": target, "active_days": days}
        if len(days) >= target and not current.get("completed_at"):
            payload["completed_at"] = datetime.now().isoformat()
        self.inner.service.table("weekly_learning_goals").upsert(payload, on_conflict="user_id,week_start").execute()


def _record(row: Any) -> dict[str, Any]:
    if row is None:
        raise ApiError(404, "AI_INVALID_INPUT")
    return json_ready(dict(row))
