# Make demo account seeding reliable so demo logins actually succeed

## The real problem

The seed is wired up but it runs as **fire-and-forget** (`void seedDemoAccounts()`) inside a middleware. When someone opens the app and immediately taps a demo login chip, the login request is processed **before** the seed finishes inserting users — so Postgres returns no user and login fails with "Invalid email or password". On subsequent attempts the seed may or may not have completed depending on timing, which is why it "sometimes" seems to not work.

On top of that, there is no visible log confirming whether the seed actually ran, so failures are silent.

## Fix

- Tie the seed to the schema readiness promise so it runs **once**, is **awaited**, and every database query (including login) waits for it to finish before running.
- Remove the racy fire-and-forget middleware call.
- Add clear, loud startup logs: when seeding starts, how many companies/users were upserted, a per-user verification step that reads the row back and confirms the stored password hash matches the demo password, and a final summary line.
- If any demo user fails verification, log a clear error with the email so it is obvious in runtime logs.
- Document exactly where seeding executes in the server lifecycle (inside the schema bootstrap, before any tRPC route can query users).

## What the user will see

- Demo login chips on the login screen will work on the very first tap, with no "Invalid email or password" error caused by timing.
- Server logs will clearly show:
  - "Ensuring production schema"
  - "Seeding demo accounts…"
  - "Upserted N companies, M users"
  - "Verified login for [admin@dock2door.ca](mailto:admin@dock2door.ca) / [customer@freshmart.ca](mailto:customer@freshmart.ca) / …"
  - "Demo seed complete"
- No new screens, no new features — only the existing demo accounts become reliably usable.

