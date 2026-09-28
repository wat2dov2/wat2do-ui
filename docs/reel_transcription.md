# Local Reel transcription

Run the existing post inspection command with `--transcribe` to retrieve a public Instagram Reel and transcribe its audio.
It uses the shared Apify exact-post scraper and OpenAI audio transcription, so provider charges apply.
Configure `APIFY_API_TOKEN` and `OPENAI_API_KEY` in the ignored `backend/.env` file.
Run from `backend/` so the existing settings loader finds that file.

```sh
cd backend
.venv/bin/python scripts/probe_instagram_post.py --transcribe \
  --url 'https://www.instagram.com/reel/DdyqycEINNe/'
```

Successful output is JSON with `url`, `caption`, and `transcript` fields.
Redirect standard output to a local file if you want to save it.
The caption is the author's post description, separate from the spoken transcript.
This command does not extract on-screen text or produce timestamps.
Transcripts are machine-generated and may contain errors, particularly with music or unclear speech.

The command uses no browser, cookies, server, or database writes.
It downloads the video into memory and sends it to OpenAI for transcription.
The current implementation accepts MP4 videos up to 24 MB and rejects larger files without silently truncating them.
Private, deleted, or otherwise unavailable Reels cannot be transcribed through this command.
Download failures require rerunning the command to fetch a fresh media URL.
Exit status is nonzero on failure, with an actionable message on standard error.

Model, download limit, and timeouts are controlled by `backend/controlbox/reel_transcription.json`.
Omit `--transcribe` to inspect the original scraped post data.
