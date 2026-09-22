from __future__ import annotations

from typing import Protocol
from uuid import uuid4

from botocore.config import Config
import boto3


ALLOWED_MIME_TYPES = {"video/mp4", "video/webm", "video/quicktime"}
MAX_UPLOAD_BYTES = 2_147_483_648
MIN_PART_BYTES = 5_242_880
DEFAULT_PART_BYTES = 16_777_216


class MediaStorage(Protocol):
    def ensure_bucket(self) -> None: ...
    def create_multipart(self, object_key: str) -> str: ...
    def presign_part(self, object_key: str, upload_id: str, part_number: int) -> str: ...
    def list_parts(self, object_key: str, upload_id: str) -> list[dict[str, str | int]]: ...
    def complete(self, object_key: str, upload_id: str, parts: list[dict[str, str | int]]) -> None: ...
    def abort(self, object_key: str, upload_id: str) -> None: ...
    def open_object(self, object_key: str): ...


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.uploads: dict[str, dict[int, bytes]] = {}
        self.multipart_ids: dict[str, str] = {}

    def ensure_bucket(self) -> None:
        return None

    def create_multipart(self, object_key: str) -> str:
        upload_id = str(uuid4())
        self.uploads[upload_id] = {}
        self.multipart_ids[upload_id] = object_key
        return upload_id

    def presign_part(self, object_key: str, upload_id: str, part_number: int) -> str:
        return f"memory://{object_key}?uploadId={upload_id}&partNumber={part_number}"

    def put_part(self, upload_id: str, part_number: int, body: bytes) -> str:
        self.uploads.setdefault(upload_id, {})[part_number] = body
        return f"etag-{part_number}"

    def list_parts(self, object_key: str, upload_id: str) -> list[dict[str, str | int]]:
        parts = self.uploads.get(upload_id, {})
        return [{"PartNumber": number, "ETag": f"etag-{number}"} for number in sorted(parts)]

    def complete(self, object_key: str, upload_id: str, parts: list[dict[str, str | int]]) -> None:
        payload = b"".join(self.uploads.get(upload_id, {}).get(int(part["PartNumber"]), b"") for part in parts)
        self.objects[object_key] = payload
        self.uploads.pop(upload_id, None)

    def abort(self, object_key: str, upload_id: str) -> None:
        self.uploads.pop(upload_id, None)
        self.multipart_ids.pop(upload_id, None)

    def open_object(self, object_key: str):
        from io import BytesIO
        return BytesIO(self.objects[object_key])


def _client(endpoint: str, access_key: str, secret_key: str, region: str, use_ssl: bool):
    scheme = "https" if use_ssl else "http"
    url = endpoint if endpoint.startswith("http") else f"{scheme}://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


class MinioStorage:
    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        public_endpoint: str,
        public_use_ssl: bool,
        region: str,
    ) -> None:
        self.bucket = bucket
        internal_ssl = endpoint.startswith("https://")
        self.internal = _client(endpoint, access_key, secret_key, region, internal_ssl)
        self.public = _client(public_endpoint, access_key, secret_key, region, public_use_ssl)

    def ensure_bucket(self) -> None:
        try:
            self.internal.head_bucket(Bucket=self.bucket)
        except Exception:
            self.internal.create_bucket(Bucket=self.bucket)

    def create_multipart(self, object_key: str) -> str:
        response = self.internal.create_multipart_upload(Bucket=self.bucket, Key=object_key)
        return response["UploadId"]

    def presign_part(self, object_key: str, upload_id: str, part_number: int) -> str:
        return self.public.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": self.bucket,
                "Key": object_key,
                "UploadId": upload_id,
                "PartNumber": part_number,
            },
            ExpiresIn=3600,
            HttpMethod="PUT",
        )

    def list_parts(self, object_key: str, upload_id: str) -> list[dict[str, str | int]]:
        pages = self.internal.get_paginator("list_parts").paginate(
            Bucket=self.bucket, Key=object_key, UploadId=upload_id
        )
        listed: list[dict[str, str | int]] = []
        for page in pages:
            for part in page.get("Parts") or []:
                listed.append({"PartNumber": int(part["PartNumber"]), "ETag": part["ETag"]})
        return listed

    def complete(self, object_key: str, upload_id: str, parts: list[dict[str, str | int]]) -> None:
        self.internal.complete_multipart_upload(
            Bucket=self.bucket,
            Key=object_key,
            UploadId=upload_id,
            MultipartUpload={"Parts": [{"ETag": part["ETag"], "PartNumber": part["PartNumber"]} for part in parts]},
        )

    def abort(self, object_key: str, upload_id: str) -> None:
        self.internal.abort_multipart_upload(Bucket=self.bucket, Key=object_key, UploadId=upload_id)

    def open_object(self, object_key: str):
        return self.internal.get_object(Bucket=self.bucket, Key=object_key)["Body"]
