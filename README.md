# NYC Apt Search

A small password-protected apartment tracking app for importing StreetEasy listing URLs into an editable comparison table.

## Features

- Import StreetEasy listing URLs through Apify.
- Store listings in SQLite.
- Compute public-transit commute times to:
  - 853 Broadway, New York, NY 10003
  - 55 Hudson Yards, New York, NY 10001
- Edit listing details directly in the table.
- Rate each listing with separate `bb-lizard` and `bb-crab` ratings.
- Sort and filter listings by neighborhood, rent, commute, laundry, date posted, year built, and average rating.
- Export visible rows to CSV.
- Password-gated UI with optional remember-me token.

## Setup

Install dependencies:

```bash
npm install
```

Create an environment file:

```bash
cp .env.example .env
```

Set the required environment variables:

```bash
APIFY_TOKEN=...
GOOGLE_MAPS_API_KEY=...
APP_PASSWORD_SHA256=...
APP_SESSION_SECRET=...
```

Generate `APP_PASSWORD_SHA256` from a password:

```bash
node -e "const crypto=require('crypto'); console.log(crypto.createHash('sha256').update(process.argv[1]).digest('hex'))" "your-password"
```

Generate `APP_SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Start production build:

```bash
npm start
```

## Data

The app uses SQLite via `better-sqlite3`. Runtime database files (`data.db`, WAL, SHM, journal files) are intentionally ignored by git.

## Security notes

This is a lightweight personal app, not a multi-user auth system. Keep the app password private and rotate `APP_SESSION_SECRET` if a remembered browser should be invalidated.
