import json
from unittest.mock import MagicMock

import pytest

from scripts.provision_development_storage import provision


def test_wrong_account_stops_before_storage_access(monkeypatch):
    session = MagicMock()
    session.client.return_value.get_caller_identity.return_value = {"Account": "other"}
    monkeypatch.setattr("scripts.provision_development_storage.boto3.Session", lambda **_: session)
    with pytest.raises(RuntimeError, match="account"):
        provision("123", "ca-central-1")
    session.client.assert_called_once_with("sts")


def test_existing_resources_are_reused_and_bucket_stays_private(monkeypatch):
    sts, s3, cf = MagicMock(), MagicMock(), MagicMock()
    sts.get_caller_identity.return_value = {"Account": "123"}
    s3.get_bucket_location.return_value = {"LocationConstraint": "ca-central-1"}
    cf.list_origin_access_controls.return_value = {
        "OriginAccessControlList": {
            "Items": [
                {"Name": "wat2do-development-assets", "Id": "oac"},
            ]
        }
    }
    cf.get_paginator.return_value.paginate.return_value = [
        {
            "DistributionList": {
                "Items": [
                    {
                        "Comment": "wat2do-development-assets",
                        "Id": "dev",
                        "ARN": "arn:dev",
                        "DomainName": "dev.cloudfront.net",
                        "Origins": {
                            "Items": [
                                {
                                    "DomainName": "wat2do-development-assets-123.s3.ca-central-1.amazonaws.com",
                                }
                            ]
                        },
                    }
                ]
            }
        }
    ]
    session = MagicMock()
    session.client.side_effect = {"sts": sts, "s3": s3, "cloudfront": cf}.__getitem__
    monkeypatch.setattr("scripts.provision_development_storage.boto3.Session", lambda **_: session)

    result = provision("123", "ca-central-1")

    assert result["STORAGE_PUBLIC_BASE_URL"] == "https://dev.cloudfront.net/media"
    s3.create_bucket.assert_not_called()
    cf.create_distribution.assert_not_called()
    assert all(
        s3.put_public_access_block.call_args.kwargs["PublicAccessBlockConfiguration"].values()
    )
    policy = json.loads(s3.put_bucket_policy.call_args.kwargs["Policy"])
    assert (
        policy["Statement"][0]["Resource"] == "arn:aws:s3:::wat2do-development-assets-123/media/*"
    )
    assert policy["Statement"][0]["Condition"]["StringEquals"]["AWS:SourceArn"] == "arn:dev"
