# AXTelegram

The Next.js application serves the Telegram dashboard and its API from one
local server process. The API is bound to loopback only.

## Requirements

- Node.js 18.18 or newer
- npm

## Run locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. For a production build:

```sh
npm run build
npm start
```

Enter the API ID and API Hash from
[my.telegram.org](https://my.telegram.org) in the dashboard. Account
credentials, Telegram sessions, schedules, and activity logs stay local in
`server/sessions/`; never share them or expose the application to the internet.

The interface includes Telegram account management, manual and recurring group
notifications, and an activity log. Schedule intervals are configurable from
1 minute to 24 hours. Use automatic messages only in groups where you have
permission to post.
