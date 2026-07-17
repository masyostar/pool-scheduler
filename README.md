# Pool Scheduler

A web application for scheduling pool staff (lifeguards, managers, and gate personnel).

## Deploy to Render

1. Create a free account at [render.com](https://render.com)
2. Push this project to a GitHub repo
3. On Render, click **New > Web Service**
4. Connect your GitHub repo
5. Render auto-detects `render.yaml` — confirm and click **Create Service**
6. Access from any phone or computer at your Render URL

## Run Locally

```
cd server
npm install
npm start
```

Open **http://localhost:3001**

## Features

- **Onboarding** — First user becomes the Operator
- **Role-based access** — Operator, Manager, Lifeguard, Gateperson
- **Weekly schedule** — Day-column grid with shift cards
- **Shift statuses** — Assigned, Open (needs coverage), Up for trade
- **Trade system** — Workers can put shifts up for trade, drop them, or claim open ones
- **Roster management** — Operator can add/remove workers and change roles
- **Notes** — Add notes to shifts (e.g. "deep end coverage")
- **Conflict detection** — Warns about overlapping shifts
- **Mobile-friendly** — Responsive design for phones and tablets
- **Auto-refresh** — Live updates every 8 seconds

## Tech Stack

- **Frontend:** Single-file HTML/CSS/JS (no build step)
- **Backend:** Express.js
- **Data Storage:** JSON file on server
