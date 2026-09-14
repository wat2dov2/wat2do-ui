"""Provision isolated development assets using the production S3/CloudFront pattern.

Run with --account-id and --region to pin the intended AWS destination.
Reruns reuse the bucket and distribution; no production resources are modified.
"""

import argparse
import json

import boto3
from botocore.exceptions import ClientError


def provision(account_id: str, region: str) -> dict[str, str]:
    session = boto3.Session(region_name=region)
    if session.client("sts").get_caller_identity()["Account"] != account_id:
        raise RuntimeError("AWS account does not match --account-id")
    bucket = f"wat2do-development-assets-{account_id}"
    s3 = session.client("s3")
    try:
        s3.head_bucket(Bucket=bucket, ExpectedBucketOwner=account_id)
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "404":
            raise
        s3.create_bucket(
            Bucket=bucket,
            CreateBucketConfiguration={"LocationConstraint": region},
            ObjectOwnership="BucketOwnerEnforced",
        )
    actual_region = s3.get_bucket_location(Bucket=bucket)["LocationConstraint"]
    if actual_region != region:
        raise RuntimeError("Existing development bucket is in a different region")
    s3.put_public_access_block(
        Bucket=bucket,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )
    s3.put_bucket_ownership_controls(
        Bucket=bucket,
        OwnershipControls={
            "Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}],
        },
    )
    s3.put_bucket_encryption(
        Bucket=bucket,
        ServerSideEncryptionConfiguration={
            "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}],
        },
    )
    s3.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={"Status": "Enabled"})
    s3.put_bucket_tagging(
        Bucket=bucket,
        Tagging={
            "TagSet": [
                {"Key": "Project", "Value": "wat2do"},
                {"Key": "Environment", "Value": "development"},
            ]
        },
    )
    cf = session.client("cloudfront")
    name = "wat2do-development-assets"
    controls = cf.list_origin_access_controls().get("OriginAccessControlList", {}).get("Items", [])
    control = next((item for item in controls if item["Name"] == name), None)
    if control is None:
        control = cf.create_origin_access_control(
            OriginAccessControlConfig={
                "Name": name,
                "Description": "Isolated Wat2Do development images",
                "SigningProtocol": "sigv4",
                "SigningBehavior": "always",
                "OriginAccessControlOriginType": "s3",
            }
        )["OriginAccessControl"]
    distributions = (
        item
        for page in cf.get_paginator("list_distributions").paginate()
        for item in page.get("DistributionList", {}).get("Items", [])
    )
    distribution = next((item for item in distributions if item["Comment"] == name), None)
    origin = f"{bucket}.s3.{region}.amazonaws.com"
    if distribution is not None:
        if distribution["Origins"]["Items"][0]["DomainName"] != origin:
            raise RuntimeError("Existing development distribution has an unexpected origin")
    else:
        distribution = cf.create_distribution(
            DistributionConfig={
                "CallerReference": bucket,
                "Comment": name,
                "Enabled": True,
                "Origins": {
                    "Quantity": 1,
                    "Items": [
                        {
                            "Id": bucket,
                            "DomainName": origin,
                            "OriginAccessControlId": control["Id"],
                            "S3OriginConfig": {"OriginAccessIdentity": ""},
                        }
                    ],
                },
                "DefaultCacheBehavior": {
                    "TargetOriginId": bucket,
                    "ViewerProtocolPolicy": "redirect-to-https",
                    "AllowedMethods": {
                        "Quantity": 2,
                        "Items": ["GET", "HEAD"],
                        "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
                    },
                    "ForwardedValues": {"QueryString": False, "Cookies": {"Forward": "none"}},
                    "MinTTL": 0,
                    "DefaultTTL": 86400,
                    "MaxTTL": 31536000,
                    "TrustedSigners": {"Enabled": False, "Quantity": 0},
                    "Compress": True,
                },
                "ViewerCertificate": {"CloudFrontDefaultCertificate": True},
                "PriceClass": "PriceClass_100",
                "HttpVersion": "http2",
                "IsIPV6Enabled": True,
            }
        )["Distribution"]
    arn = f"arn:aws:s3:::{bucket}"
    s3.put_bucket_policy(
        Bucket=bucket,
        Policy=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "AllowDevelopmentCloudFrontRead",
                        "Effect": "Allow",
                        "Principal": {"Service": "cloudfront.amazonaws.com"},
                        "Action": "s3:GetObject",
                        "Resource": f"{arn}/media/*",
                        "Condition": {"StringEquals": {"AWS:SourceArn": distribution["ARN"]}},
                    },
                    {
                        "Sid": "DenyInsecureTransport",
                        "Effect": "Deny",
                        "Principal": "*",
                        "Action": "s3:*",
                        "Resource": [arn, f"{arn}/*"],
                        "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                    },
                ],
            }
        ),
    )
    return {
        "AWS_REGION": region,
        "STORAGE_BUCKET_NAME": bucket,
        "STORAGE_PUBLIC_BASE_URL": f"https://{distribution['DomainName']}/media",
        "distribution_id": distribution["Id"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--region", required=True, choices=["ca-central-1"])
    args = parser.parse_args()
    print(json.dumps(provision(args.account_id, args.region), indent=2))
