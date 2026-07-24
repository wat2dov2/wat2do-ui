# Instagram API One-Account Publishing Test

This guide tests automatic Instagram carousel publishing with one Wat2Do account.
It uses the Instagram API with Instagram Login, does not require a connected Facebook Page, and is intended to run with the Meta app in Development mode.

The test publishes a real two-image carousel.
Use a low-risk Wat2Do account and disposable test images.

Expected setup time: 30 to 60 minutes.

## 1. Prepare the Instagram account

Before changing the account:

- Confirm that its email, password, and two-factor authentication are accessible.
- Make sure the profile can be public.
- Record its current account type.

In the Instagram application:

1. Open the profile.
2. Open **Menu**.
3. Select **Settings and activity**.
4. Find **Account type and tools**.
5. Select **Switch to professional account**.
6. Choose an appropriate category.
7. Choose **Business**.
8. Skip optional advertising and contact-information steps.
9. Confirm that **Professional dashboard** now appears.

Professional accounts cannot be private.
See [Instagram's professional-account documentation](https://www.facebook.com/help/instagram/138925576505882).

## 2. Create the Meta developer app

1. Visit [Meta for Developers](https://developers.facebook.com/apps/).
2. Sign in with a Facebook or Meta account.
3. Select **Create App**.
4. If Meta asks for a use case, choose the Instagram API or an option similar to **Manage everything on Instagram**.
5. If Meta asks for an app type, choose **Business**.
6. Name the app `Wat2Do Instagram Publisher`.
7. Keep the app in **Development mode**.
8. Do not request App Review for this test.

Meta changes its dashboard labels periodically.
The required product is **Instagram API with Instagram Login**.

Do not choose the deprecated Instagram Basic Display product.

This route supports Business and Creator accounts and does not require a connected Facebook Page.
See [Meta's Instagram Login documentation](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login).

## 3. Configure the Instagram product

Inside the Meta app:

1. Open **Add products** or **Use cases**.
2. Add **Instagram**.
3. Select **API setup with Instagram login**.
4. Locate the permissions or scopes section.
5. Enable only these permissions:

```text
instagram_business_basic
instagram_business_content_publish
```

Messaging, comments, insights, ads, and webhooks are not required for this test.

## 4. Add the Instagram account as a tester

If the API setup page already offers **Add Instagram account** or **Generate access token**, try that first.

If Meta requires a tester:

1. Open **App roles** and then **Roles**.
2. Select **Add people**.
3. Choose **Instagram Tester**.
4. Enter the exact Instagram username.
5. Send the invitation.

While logged into that Instagram account, open [Instagram Apps and Websites](https://www.instagram.com/accounts/manage_access/).

Find **Tester Invites** and accept the app invitation.
Return to the Meta dashboard and refresh it.

## 5. Generate the access token

In the Meta dashboard:

1. Open **Instagram**.
2. Open **API setup with Instagram login**.
3. Find the connected or test Instagram account.
4. Select **Generate access token**.
5. Log into the correct Instagram account.
6. Approve the requested permissions.
7. Copy the token immediately.
8. Record the Instagram user ID if Meta displays it.

Treat the access token like a password.
Do not commit it, paste it into chat, store it in source code, or include it in a screenshot.

## 6. Verify the token

Open Terminal.
The following command reads the token without placing it in shell history:

```bash
read -s "IG_ACCESS_TOKEN?Paste Instagram token: "
export IG_ACCESS_TOKEN
echo
export IG_API_VERSION=v23.0
```

If the Meta dashboard specifies another supported API version, use that version instead.

Check the identity attached to the token:

```bash
curl -sS -G \
  "https://graph.instagram.com/${IG_API_VERSION}/me" \
  -H "Authorization: Bearer ${IG_ACCESS_TOKEN}" \
  --data-urlencode "fields=id,username"
```

The response should resemble:

```json
{
  "id": "17841400000000000",
  "username": "your.wat2do.account"
}
```

Stop if the response identifies the wrong account.

Copy the returned `id` and set it in the current shell:

```bash
export IG_USER_ID='17841400000000000'
```

## 7. Prepare two test images

Create two JPEG images with these properties:

- 1080 by 1350 pixels.
- Standard JPEG encoding.
- Publicly accessible through HTTPS.
- No login, cookies, or expiring browser session required.
- The URL returns the image itself instead of an HTML page.

Upload the files to a public Supabase Storage bucket or another server under your control.
Open each URL in an incognito browser window to confirm that authentication is not required.

Set the image URLs in the current shell:

```bash
export IMAGE_ONE_URL='https://your-public-host/test-event-1.jpg'
export IMAGE_TWO_URL='https://your-public-host/test-event-2.jpg'
```

Instagram downloads each image from the supplied URL.
See [Meta's image-container documentation](https://www.postman.com/meta/instagram/request/23987686-f4b5a72d-a125-4080-8968-93de1a549e68).

## 8. Create the first carousel item

```bash
curl -sS -X POST \
  "https://graph.instagram.com/${IG_API_VERSION}/${IG_USER_ID}/media" \
  -H "Authorization: Bearer ${IG_ACCESS_TOKEN}" \
  --data-urlencode "image_url=${IMAGE_ONE_URL}" \
  --data-urlencode "is_carousel_item=true"
```

The response should resemble:

```json
{
  "id": "FIRST_CONTAINER_ID"
}
```

Copy the returned ID:

```bash
export CHILD_ONE_ID='FIRST_CONTAINER_ID'
```

## 9. Create the second carousel item

```bash
curl -sS -X POST \
  "https://graph.instagram.com/${IG_API_VERSION}/${IG_USER_ID}/media" \
  -H "Authorization: Bearer ${IG_ACCESS_TOKEN}" \
  --data-urlencode "image_url=${IMAGE_TWO_URL}" \
  --data-urlencode "is_carousel_item=true"
```

Copy the returned ID:

```bash
export CHILD_TWO_ID='SECOND_CONTAINER_ID'
```

## 10. Create the carousel

```bash
curl -sS -X POST \
  "https://graph.instagram.com/${IG_API_VERSION}/${IG_USER_ID}/media" \
  -H "Authorization: Bearer ${IG_ACCESS_TOKEN}" \
  --data-urlencode "media_type=CAROUSEL" \
  --data-urlencode "children=${CHILD_ONE_ID},${CHILD_TWO_ID}" \
  --data-urlencode "caption=Wat2Do automatic carousel test. Please ignore."
```

Copy the returned parent container ID:

```bash
export CAROUSEL_ID='CAROUSEL_CONTAINER_ID'
```

Wait approximately 10 to 20 seconds before publishing.

## 11. Publish the carousel

The following command creates a real Instagram post:

```bash
curl -sS -X POST \
  "https://graph.instagram.com/${IG_API_VERSION}/${IG_USER_ID}/media_publish" \
  -H "Authorization: Bearer ${IG_ACCESS_TOKEN}" \
  --data-urlencode "creation_id=${CAROUSEL_ID}"
```

The response should resemble:

```json
{
  "id": "PUBLISHED_INSTAGRAM_MEDIA_ID"
}
```

The publishing endpoint accepts either a single-media container or a carousel container.
See [Meta's publishing documentation](https://www.postman.com/meta/instagram/request/23987686-299b176b-90aa-4d8a-b6cf-e6028fc69de5).

## 12. Verify the post

Open the Instagram profile and confirm:

- The post exists.
- It has two carousel slides.
- Both images are correctly cropped.
- The caption is correct.
- The post came from the intended account.

Delete the test post manually afterward if desired.

## Common failures

### Permission error

- Confirm that the account is Professional.
- Confirm that the tester invitation was accepted.
- Generate a fresh token after accepting the invitation.
- Confirm that `instagram_business_content_publish` was granted.
- Confirm that requests use `graph.instagram.com`, not `graph.facebook.com`.

### Instagram cannot download an image

- Open the URL in an incognito browser.
- Confirm that the URL returns an actual JPEG.
- Remove authentication and redirect requirements.
- Avoid Instagram CDN source URLs because they can expire.

### Container is not ready

Wait 15 to 30 seconds and retry the final publishing request.
Do not immediately create another carousel.

## Successful test criteria

If this test works, it verifies all of the following:

- Professional-account eligibility.
- Development-mode authorization.
- Publishing without completing App Review.
- Public image ingestion.
- Carousel creation.
- Automatic publication.
