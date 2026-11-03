# Creative Studio (v1.65, stage 4a: brand story and post images; no video yet)

* Workspace page `/creative` (`client/src/pages/CreativeStudio.jsx`), menu item shown only when `GET /api/creative/status` says AI is on for the workspace, a platform Gemini key exists and credits are left. Permission area: `content`.
* Tables in the workspace database (`server/src/creativeSchema.js`): `creative_brand` (one row), `creative_items` (stories keep their text; images keep a storage reference). Platform database: `ai_reports`.
* Service `services/creativeStudio.js`: brand profile (starts from Branding settings), story writer (Gemini text, JSON), post images (Gemini image model, default `gemini-2.5-flash-image`, setting `creative_image_model`; sizes square 1:1, portrait 4:5, story 9:16; 1-3 options, each one call). Options are returned to the browser and only stored when the user saves one (magic-byte check, quota check, then object storage module `creative` or the workspace's `uploads/media` when storage is not configured).
* Every call goes through `aiGateway.js` (`geminiGenerate`, `geminiImage`): gatekeeper, metering in USD/PKR, credits. Credit costs: story 1, image 3 (`CREDIT_COST`). A failed or Google-blocked image is not charged but counts toward the daily limit. If credits run out mid-batch the options already made are returned with a note.
* Safety: `services/aiSafety.js` refuses clearly harmful, illegal or deceptive requests before any model call (no cost); models keep their own filters. Report button on every result -> `POST /api/creative/report` -> console AI page > Reported AI answers (`GET /ai/reports`, `PUT /ai/reports/:id`).
* Not in this stage: video reels, Azure voice-overs, logo placed inside images, sending an image straight to the Content Calendar.

## Stage 4b: video reels and voice-overs (v1.66)
* Reel = one Gemini Veo clip, 8 seconds, 9:16 (`REEL_SECONDS` in `aiGateway.js`; model setting `creative_video_model`, default `veo-3.0-fast-generate-001`). 16 and 24 second reels join 2 or 3 clips with ffmpeg (see Finished reels below).
* Voice-over: Azure Speech (`azureSpeak`), max 600 characters, voices from settings `azure_voice_en` / `azure_voice_ur` (defaults en-US-JennyNeural, ur-PK-UzmaNeural). The audio is stored next to the video and plays separately (no mixing).
* Credits: 8 per video second, 1 per 100 voice characters (`REEL_CREDITS`). The request must carry `accept_cost` equal to the quoted total (`POST /api/creative/reels/quote`). The voice is made first, then the video job starts; a failed start refunds the voice. Refunds are negative-credit ledger rows (`purpose='refund'`), not counted as uses.
* Jobs: workspace table `creative_jobs`; `runReelJobs()` (every 20 s from `index.js`) opens only workspaces that started a video in the last 40 minutes, polls Google, downloads, stores in the workspace's folder, notifies the requester. Timeout 25 minutes. At most 2 running per workspace.
* Console AI page: Video voices card (dropdowns from Azure's voice list, Hear it preview) and the Azure Test the connection button (`POST /ai/azure/test`, `PUT /ai/voices`, `POST /ai/voices/preview`).
* Default video price estimate is $0.15 per second (Veo fast); change it in the price list.
* Not live-tested against Google or Azure from this environment.

## Guided tour

Creative Studio has its own short tour (`creative` in `shared/help/tours.js`). It starts the first time a person opens the page and can be replayed with the Take the tour button. See CLAUDE.md > Guided tours and help.

## Finished reels (v1.69)

* `services/ffmpeg.js` checks `ffmpeg`/`ffprobe` at startup. Without them reels are one 8-second clip with the voice as a separate file; with them: 8, 16 or 24 seconds (1 to 3 clips), one MP4. The deploy installs ffmpeg through `.github/scripts/remote-bootstrap.sh`; by hand: `apt-get update && apt-get install -y ffmpeg`.
* Voice path per reel: `script` (default; Azure reads the exact script, ffmpeg lays it over the video and drops Veo's own sound) or `speech` (the quoted line is in the Veo prompt, Veo's sound is kept; for several clips the lines are shared out sentence by sentence).
* Cost: 8 credits per video second, so 64 / 128 / 192; plus 1 credit per 100 voice characters on the script path only. Script limit 600 characters per 8 seconds. Hearing the voice first charges the voice credits once and the reel start reuses it for 30 minutes.
* Any failure before the file exists refunds everything. If only the voice merge fails on a single clip, the clip and the voice are delivered separately and nothing is refunded.
* Punjabi is not offered to workspaces. Console > AI > Voice test lab tries one line through both paths (Azure voice; one real 8-second Veo clip after a cost confirmation).
