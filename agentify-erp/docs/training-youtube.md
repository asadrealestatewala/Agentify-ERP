# Training videos on YouTube

Training videos are posted to the platform's YouTube channel once, from **Console > System > Training videos**. Every workspace then shows the YouTube link, title and description saved in the console library, so the server does not serve video files.

## How it works

* The console library (`training_posts` in the platform database) holds each video: wording, roles that see it in a new workspace, visibility, status and the YouTube link. Videos shipped in `server/assets/training` appear there automatically; the Super Admin can also add a new video (MP4/WebM/MOV up to 500 MB).
* **Post to YouTube** uploads in the background (YouTube Data API v3, resumable upload) as unlisted, public or private. The console page refreshes until it is done. A failure is shown on the video with a plain reason and can be retried.
* A video posted from an upload to the console loses its server copy automatically. Videos shipped with the system keep their copy until **Delete server copy** is used (they return with every deploy but are never served once a link exists; remove the file from `server/assets/training` in a later change).
* Each workspace copies posted videos into its own library the next time it opens Training videos (and again after any console change). A video with a link shows **Watch on YouTube**; the file route redirects to it. Its wording is managed centrally. Videos without a link keep playing from the server.

## Google setup (done once by the platform owner)

1. Create a project in Google Cloud and enable **YouTube Data API v3**.
2. Configure the OAuth consent screen. While the app is in *Testing*, Google expires the connection every 7 days and only listed test users can connect; set it to *In production* for a lasting connection.
3. Create an OAuth client of type *Web application* with the redirect address `https://<main domain>/api/platform/oauth/google/callback` (the same one used for Google sign-in).
4. Enter the client ID and secret under Console > Integrations > Google, or set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. In Console > System > Training videos choose **Connect YouTube** and sign in as the account that owns the channel. The permission asked for is upload only; the refresh token is stored encrypted.
6. Quota: the default is 10,000 units a day and one upload costs about 1,600, so about 6 uploads a day. Request more in the Google Cloud quota page if needed.
7. YouTube forces videos uploaded through a Google project created after July 2020 to **private** until that project passes YouTube's API Services compliance audit. Until then, posted videos stay private whatever visibility is chosen; submit the audit form for the project to enable unlisted and public.

**Wrong channel?** Disconnect, then connect again and choose the brand channel on the Google channel screen; each posted video shows its channel ID. Use **Unlink from YouTube** on a video to forget its link and post it again (delete the video itself in YouTube Studio; the upload permission cannot delete videos).

Until steps 1 to 5 are done the page reports *Not configured* and nothing else changes.
