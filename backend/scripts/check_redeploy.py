#!/usr/bin/env python3
import datetime
import json
import os
import subprocess
import sys


def check_redeploy():
    project_id = os.getenv("RAILWAY_PROJECT_ID")
    if not project_id:
        print("Error: RAILWAY_PROJECT_ID is not set in the environment.")
        sys.exit(1)

    try:
        # Run railway command to list deployments
        cmd = [
            "railway",
            "deployment",
            "list",
            "--service",
            "wat2do-api",
            "--environment",
            "production",
            "--json",
        ]
        # We pass RAILWAY_PROJECT_ID in the env when invoking subprocess if it is in the parent env
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        deploys = json.loads(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error running railway CLI command: {e.stderr}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error parsing railway JSON output: {e}")
        sys.exit(1)

    # Filter for successful deployments
    success_deploys = [d for d in deploys if d.get("status") == "SUCCESS"]

    should_deploy = "true"
    if not success_deploys:
        print("No successful deployments found on Railway. Triggering redeploy.")
    else:
        # Get creation timestamp of the latest successful deploy
        last_deploy_str = success_deploys[0]["createdAt"]
        # Convert the Railway ``Z`` suffix to an explicit UTC offset.
        last_deploy_dt = datetime.datetime.fromisoformat(last_deploy_str.replace("Z", "+00:00"))

        # Get latest commit datetime from git log
        try:
            commit_ts_str = (
                subprocess.check_output(["git", "log", "-1", "--format=%cI"]).decode().strip()
            )
            commit_dt = datetime.datetime.fromisoformat(commit_ts_str)
        except Exception as e:
            print(f"Error getting git commit timestamp: {e}")
            sys.exit(1)

        print(f"Last successful deployment (UTC): {last_deploy_dt}")
        print(f"Latest commit on main (UTC):       {commit_dt}")

        if commit_dt > last_deploy_dt:
            print("New commits detected since the last successful deployment. Triggering redeploy.")
            should_deploy = "true"
        else:
            print("No new commits since the last successful deployment. Skipping redeploy.")
            should_deploy = "false"

    # Write output to GITHUB_OUTPUT if running inside GitHub Actions
    github_output_path = os.getenv("GITHUB_OUTPUT")
    if github_output_path:
        with open(github_output_path, "a") as f:
            f.write(f"should_deploy={should_deploy}\n")
        print(f"Set GITHUB_OUTPUT should_deploy to {should_deploy}")
    else:
        print(f"Not running in GitHub Actions. Output: should_deploy={should_deploy}")


if __name__ == "__main__":
    check_redeploy()
