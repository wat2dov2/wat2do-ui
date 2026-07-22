# Instagram Automation Commands

# List schools in the spreadsheet
cd /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend && python scripts/follow_from_xlsx.py --list-schools

# Run follow automation for a school with your session cookie
cd /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend && IG_SESSIONID='<sessionid>' python scripts/follow_from_xlsx.py --username <school>.wat2do.io

# Run bell notification automation on emulator (non-headless / normal GUI window)
# First: open Instagram on the emulator and navigate to "All profiles you follow".
# Then run the script - it only walks that list and taps each row's bell.
~/Library/Android/sdk/emulator/emulator -avd $(~/Library/Android/sdk/emulator/emulator -list-avds | head -n 1) -no-audio & \
sleep 2; \
~/Library/Android/sdk/platform-tools/adb wait-for-device

# Run GUI emulators
~/Library/Android/sdk/emulator/emulator -avd Pixel_10 -read-only -port 5554 -no-audio & \
sleep 2; \
~/Library/Android/sdk/platform-tools/adb wait-for-device && \
python3 /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend/scripts/automate_bell_notifications.py --device emulator-5554


# Confirm both emulator IDs are available
~/Library/Android/sdk/platform-tools/adb devices

# Run bell notification automation on emulator (headless / background, saves CPU/GPU)
# Still requires the "All profiles you follow" screen to already be open on that emulator.
cd /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend && \
~/Library/Android/sdk/emulator/emulator -avd Pixel_10 -read-only -port 5554 -no-window -no-audio > /dev/null 2>&1 & \
sleep 2; \
~/Library/Android/sdk/platform-tools/adb wait-for-device && \
python3 /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend/scripts/automate_bell_notifications.py --device emulator-5554

# Stop a specific emulator
~/Library/Android/sdk/platform-tools/adb -s emulator-5554 emu kill 2>/dev/null; pkill -f qemu-system
