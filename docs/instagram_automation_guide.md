# Instagram Automation Commands

Browser-cookie automation is paused.
Do not extract or provision Instagram browser cookies for notification processing or organization following.
The active notification path uses Android Instagram accounts and processes only media IDs explicitly present in each notification.

## Android notification setup

Configure the official Instagram Android app to deliver notifications through the existing `new_instagram_post` repository dispatch.
For each logged-in Instagram account, open the consolidated `All profiles you follow` screen and run the existing bell configuration against the correct device serial:

```sh
cd backend
python scripts/automate_bell_notifications.py --device emulator-5554
python scripts/automate_bell_notifications.py --device emulator-5556
```
