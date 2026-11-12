# Telegram server module

The Telegram MTProto client and local session management are shared by the
Next.js API routes in `app/api/`. Start the combined UI and API from the
repository root; see the root README.

Account credentials, Telegram sessions, recurring schedules, and activity
logs are stored under `server/sessions/` with owner-only permissions. Session
files grant access to their Telegram accounts: do not share them or expose the
local application to the internet.

Use recurring notifications only in groups where you have permission to post.
Message contents and Telegram login codes are not stored in the activity log.
