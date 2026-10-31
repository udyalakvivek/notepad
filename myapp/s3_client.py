import boto3
from django.conf import settings
from botocore.config import Config


def get_s3_client():
    kwargs = {}
    endpoint_url = getattr(settings, "cc", None)
    access_key = getattr(settings, "AWS_ACCESS_KEY_ID", None)
    secret_key = getattr(settings, "AWS_SECRET_ACCESS_KEY", None)
    region = getattr(settings, "AWS_DEFAULT_REGION", None)

    if endpoint_url:
        kwargs["endpoint_url"] = endpoint_url
    if access_key:
        kwargs["aws_access_key_id"] = access_key
    if secret_key:
        kwargs["aws_secret_access_key"] = secret_key
    if region:
        kwargs["region_name"] = region

    return boto3.client(
        "s3",
        config=Config(
            s3={"addressing_style": "path"},
            connect_timeout=3,
            read_timeout=5,
            retries={"max_attempts": 2}
        ),
        **kwargs
    )


s3_client = get_s3_client()