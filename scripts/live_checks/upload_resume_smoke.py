#!/usr/bin/env python3
"""Smoke: multipart upload resume. Requires teacher JWT and media API."""

from __future__ import annotations

import argparse
import os
import sys
import uuid

import httpx


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default=os.environ.get("VITE_SKILLMIND_API_URL", ""))
    parser.add_argument("--token", default=os.environ.get("SKILLMIND_TEACHER_JWT", ""))
    parser.add_argument("--course-id", required=True)
    parser.add_argument("--lesson-id", required=True)
    parser.add_argument("--bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--abort-after-parts", type=int, default=1)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if not args.api or not args.token:
        print("Set --api/--token or VITE_SKILLMIND_API_URL and SKILLMIND_TEACHER_JWT", file=sys.stderr)
        return 2
    headers = {"Authorization": f"Bearer {args.token}", "Content-Type": "application/json"}
    client = httpx.Client(base_url=args.api.rstrip("/"), headers=headers, timeout=120.0)
    started = client.post(
        "/v1/media/uploads",
        json={
            "course_id": args.course_id,
            "lesson_id": args.lesson_id,
            "filename": f"smoke-{uuid.uuid4().hex}.mp4",
            "mime_type": "video/mp4",
            "expected_bytes": args.bytes,
        },
    )
    started.raise_for_status()
    body = started.json()
    upload_id = body["upload_id"]
    part_size = int(body["part_size_bytes"])
    total = max(1, (args.bytes + part_size - 1) // part_size)
    uploaded = 0
    for part in range(1, total + 1):
        if part > args.abort_after_parts and not args.resume:
            print(f"stopped after {uploaded} parts; re-run with --resume")
            return 0
        signed = client.post(f"/v1/media/uploads/{upload_id}/parts/{part}/url").json()
        start = (part - 1) * part_size
        chunk = b"\0" * min(part_size, args.bytes - start)
        put = httpx.put(signed["url"], content=chunk, timeout=300.0)
        put.raise_for_status()
        uploaded = part
        print(f"part {part}/{total}")
        if part == args.abort_after_parts and args.resume:
            state = client.get(f"/v1/media/uploads/{upload_id}").json()
            print(f"resume checkpoint parts={len(state.get('parts') or [])}")
    done = client.post(f"/v1/media/uploads/{upload_id}/complete")
    print(done.status_code, done.json())
    return 0 if done.is_success else 1


if __name__ == "__main__":
    raise SystemExit(main())
