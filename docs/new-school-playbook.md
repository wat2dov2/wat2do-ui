# New School Playbook

Use this playbook when adding a new Wat2Do school chapter.

Complete the steps in order and record the verification results before considering the chapter ready.

## 1. Gather the school identity

1. Choose one canonical lowercase school slug.
2. Confirm the official school name, official Instagram handle, timezone, and public website.
3. Confirm the chapter URL will be `https://<schoolslug>.wat2do.io`.
4. Confirm the Instagram username will be `<schoolslug>.wat2do.io`.
5. Store credentials only in the approved secret manager or ignored local environment files.
6. Never put passwords, access tokens, session cookies, or refresh tokens in this playbook, source code, screenshots, or shell history.

## 2. Create and verify the school logo

1. Add the school logo as `assets/school-logos/<schoolslug>.jpg`.
2. Use the existing school-logo asset format and dimensions.
3. Use the primary school color as the logo background.
4. Use the secondary school color for the Wat2Do mark or foreground artwork.
5. Update `assets/school-logos/colors.json` with the canonical slug and the two semantic colors.
6. Check that the manifest points to the correct filename and that the image exists.
7. Inspect the logo at avatar size and at social-card size.
8. Confirm the logo has adequate contrast and that the primary background is not accidentally replaced by white.

## 3. Add the school to the application

1. Search the repository for the existing school configuration and reuse its established shape.
2. Add the school to the canonical school list used by the frontend.
3. Add the school record through the normal Supabase migration path.
4. If the schema or seeded relationships change, update `backend/supabase/seed.sql` in the same change.
5. Add any school-specific control values to the appropriate feature-named JSON file under `backend/controlbox/`.
6. Do not place secrets in controlbox files.
7. Confirm the school host resolves to the correct school context.
8. Confirm the school appears in school pickers, school pages, organization pages, and any school-filtered API responses where applicable.

## 4. Configure the Instagram account

The following setup was used for the Guelph chapter and is the standard profile setup for a new chapter.

### 4.1 Start the Android emulator

1. Close any stale or read-only emulator session using the target port.
2. Start the approved Android Virtual Device from Android Studio Device Manager.
3. Confirm the device is available through ADB as `emulator-5554` or the active emulator serial.
4. Open Instagram and confirm the intended chapter account is active before editing anything.
5. If the account is not signed in, sign in using the approved credential workflow.
6. Do not paste or expose the password in terminal output, screenshots, documentation, or chat.

### 4.2 Set the profile image

1. Push the school logo to the emulator, for example:

   ```sh
   adb -s emulator-5554 push assets/school-logos/<schoolslug>.jpg /sdcard/Download/<schoolslug>.jpg
   ```

2. Trigger a media scan if the image does not appear in the picker.
3. Open the chapter profile and choose **Edit profile**.
4. Choose **Edit picture or avatar** and then **Choose from library**.
5. Grant the minimum photo access needed to select the logo.
6. Select the pushed school logo.
7. Confirm the circular crop shows the school primary color as the background and the white or secondary-color Wat2Do mark clearly.
8. Save the profile image.

### 4.3 Set the name and bio

1. Set the display name to `Wat2Do | Sharing Events @ <schoolslug>`.
2. Confirm Instagram's name-change warning before saving.
3. Set the bio to exactly three lines:

   ```text
   Connecting events on campus to you
   Official Wat2Do chapter @<official_school_instagram_handle>
   Checkout all events below 👇
   ```

4. Use the official school Instagram handle so Instagram creates a linked mention.
5. Confirm the mention is blue and resolves to the official school account.
6. Save the bio and reopen the profile to verify line breaks and the pointing-down emoji.

### 4.4 Set the category

1. In **Edit profile**, open the category selector.
2. Set the category to the closest available community category.
3. Prefer **Community Organization** when Instagram does not offer an exact **Community** option.
4. Confirm the selected category is visible in the professional profile settings.

### 4.5 Add the chapter link

1. In **Edit profile**, open **Links** and choose **Add link**.
2. Set the URL to `https://<schoolslug>.wat2do.io`.
3. Set the link title to `Wat2Do`.
4. Save the link.
5. Reopen Links and verify both the title and host are correct.
6. If Instagram reports that the account is not eligible to add links, check Account Status and resolve the restriction before retrying.

### 4.6 Add contact information

1. Open **Edit profile** and then **Contact options**.
2. Set the business email to `tqiu@uwaterloo.ca`.
3. Leave phone, WhatsApp, and address unset unless the owner explicitly supplies approved values.
4. Save and confirm the profile shows the email contact banner.

### 4.7 Add 24-hour business hours

1. Open **Edit profile**, **Add banners**, and **Business hours**.
2. Set the account timezone to the school's local timezone.
3. Add every day of the week.
4. Choose **Open 24 hours** for Sunday through Saturday.
5. Choose **Add to profile** and confirm the business-hours banner appears.

### 4.8 Add profile music

1. Open **Edit profile**, **Add banners**, and **Music**.
2. Search for `whats a future funk`.
3. Select `What's a Future Funk? (Sped Up)` by DezLeppa.
4. Return to the profile editor and verify the selected track title and artist.

### 4.9 Verify the completed profile

Confirm all of the following from the public profile view:

- The correct chapter username is displayed.
- The display name uses the canonical slug.
- The school logo is the profile image.
- The bio has three lines, a linked official-school mention, and 👇.
- The Wat2Do chapter link opens the correct school host.
- The email contact option is present.
- Business hours show 24 hours for all seven days.
- The requested music track is displayed.
- No personal phone number, address, password, token, or unrelated account information is visible.

## 5. Verify the application and database

1. Run the frontend checks from `frontend/`:

   ```sh
   npm run check
   ```

2. Run the backend test suite with the required local environment variables configured.
3. Reset the local Supabase database when migrations or seed data changed:

   ```sh
   cd backend && supabase db reset
   ```

4. Confirm the new school survives the reset and appears in the expected API responses.
5. Confirm the school logo and school host work in a normal logged-out user flow.
6. Record any blocked checks and the exact reason in the change handoff.

## 6. Handoff checklist

- [ ] Canonical slug and official school identity confirmed.
- [ ] Logo JPG added and visually checked.
- [ ] Logo manifest and school colors updated.
- [ ] Supabase migration and seed data updated where required.
- [ ] School appears in application school lists and host routing.
- [ ] Instagram account is the intended chapter account.
- [ ] Profile image, display name, bio, category, link, contact email, hours, and music verified.
- [ ] No credentials or tokens were committed.
- [ ] Frontend lint, i18n audit, and type-check passed.
- [ ] Backend tests passed, or their environment blocker was recorded.
- [ ] Local Supabase reset passed when database changes were made.
