import secrets
from pathlib import Path
from django.conf import settings
from rest_framework.response import Response
from rest_framework import status
from .s3_client import s3_client


def ensure_bucket_exists(bucket_name):
    if not bucket_name:
        return
    try:
        s3_client.head_bucket(Bucket=bucket_name)
    except Exception:
        try:
            s3_client.create_bucket(Bucket=bucket_name)
        except Exception:
            pass


def upload_to_s3(file, slug):
    """
    Uploads a file to S3.
    Returns (file_key, None) on success, or (None, err) on error/unconfigured.
    """
    if not file:
        return None, Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

    suffix = Path(file.name).suffix[:16]
    file_key = f"notes/{slug}/{secrets.token_hex(16)}{suffix}"
    bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", None)

    if bucket_name:
        ensure_bucket_exists(bucket_name)
        try:
            if hasattr(file, "seek"):
                try:
                    file.seek(0)
                except Exception:
                    pass
            content_type = getattr(file, "content_type", "application/octet-stream") or "application/octet-stream"
            s3_client.upload_fileobj(
                file,
                bucket_name,
                file_key,
                ExtraArgs={"ContentType": content_type}
            )
            return file_key, None
        except Exception as e:
            if hasattr(file, "seek"):
                try:
                    file.seek(0)
                except Exception:
                    pass
            return None, e

    return None, None


def delete_from_s3(file_key):
    """
    Deletes an object from S3 by file_key.
    """
    bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", None)
    if not file_key or not bucket_name:
        return
    try:
        s3_client.delete_object(
            Bucket=bucket_name,
            Key=str(file_key)
        )
    except Exception:
        pass


def get_s3_file(file_key):
    """
    Fetches an object stream from S3 by file_key.
    Returns (stream, content_type) or (None, None).
    """
    bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", None)
    if not file_key or not bucket_name:
        return None, None
    try:
        response = s3_client.get_object(
            Bucket=bucket_name,
            Key=str(file_key)
        )
        return response["Body"], response.get("ContentType", "application/octet-stream")
    except Exception:
        return None, None


def upload_s3(file):
    """
    Legacy helper for general upload.
    """
    if not file:
        return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
    file_key, err = upload_to_s3(file, "general")
    if file_key:
        return Response(
            {
                "success": True,
                "message": "File uploaded successfully",
                "file_key": file_key,
            },
            status=status.HTTP_200_OK,
        )
    return Response({"error": str(err)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


