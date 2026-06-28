<div align="center">

# Price Researcher

**Automated game price & popularity intelligence for resellers**

[![CI](https://github.com/JoaoVitor2310/price-researcher/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoVitor2310/price-researcher/actions/workflows/ci.yml)
[![Deploy](https://github.com/JoaoVitor2310/price-researcher/actions/workflows/deploy.yml/badge.svg)](https://github.com/JoaoVitor2310/price-researcher/actions/workflows/deploy.yml)
![Node](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue)

> **Personal project** built for real production use at **CarcaDeals**, a game key reseller.<br/>
> Replaced a fully manual process, cutting research time from hours to minutes.

**🟢 Live demo → [price.carcadeals.com](https://price.carcadeals.com)**<br/>
<sub>No token required — paste any game names and see the pipeline run (limited to 10 games in demo mode).</sub>

</div>

---

## The Problem

A supplier sends a list of 200+ game titles. The buyer needs to cross-reference each title against marketplaces to decide what's worth purchasing — a process that previously took **hours of manual copy-pasting** across multiple sites, with no signal for whether a game would actually sell.

## The Solution

Price Researcher fully automates that workflow:

1. Receives a list of game names + a minimum popularity threshold
2. Fetches the **24h peak player count** from SteamCharts for each game — in parallel batches
3. Filters out games below the popularity threshold (low demand = hard to resell)
4. Filters out known free-to-play titles that have no resale value
5. Scrapes **AllKeyShop** for the best current market price on each qualifying game
6. In authenticated mode, pushes the results directly into the inventory system — zero manual steps

A second async flow accepts a **Steam ID**, crawls the user's trade lists on SteamTrades, extracts game names, and runs the same pipeline automatically.

---

## Business Impact

| Before | After |
|---|---|
| 2–4 hours of manual research per list | ~5 minutes end-to-end |
| Human error in copy-pasting prices | Zero manual steps |
| No popularity signal → bad purchases | Games pre-filtered by real demand data |
| Results copied manually to inventory | Direct integration — results pushed automatically |
| No SteamTrades integration | Full trade list automation via Steam ID |

---

## Two-Mode Design

The API supports two modes controlled by a bearer token:

| | Demo mode | Authenticated mode |
|---|---|---|
| Token | Not provided | Valid `INTERNAL_SECRET` |
| Game limit | 10 | Unlimited |
| Output | JSON returned in the UI | Pushed to inventory system |
| Use case | Try it out | Production pipeline |

This allows the tool to be publicly accessible for demonstration while keeping the full pipeline secure. Auth lives in the controller (presentation layer) — the use case is auth-agnostic and only knows whether a `GameTradeImporter` was injected.

---

## Technical Highlights

- **Clean Architecture** — strict `Domain → Application → Infrastructure → Presentation` layering with port/adapter interfaces for every external dependency, enabling full testability without a real browser or network
- **Anti-bot scraping** — Puppeteer Real Browser + stealth plugin to bypass Cloudflare and similar protections on AllKeyShop and SteamTrades
- **Multi-strategy concurrency** — SteamCharts runs in parallel batches of 50; AllKeyShop is strictly sequential (one browser page); SteamTrades uses a serialized promise gate to avoid rate limits
- **Rate limit resilience** — `fetchWithRetry` honours `Retry-After` headers on HTTP 429 with exponential backoff (3 attempts, 5 s base delay); `gotoWithRetry` handles Puppeteer timeouts the same way
- **Inventory integration** — `HttpGameTradeImporter` implements the `GameTradeImporter` port using native `fetch` with a 15 s `AbortController` timeout, posting structured results to the inventory system over a private bearer-authenticated API
- **Domain-level exclusion list** — `filterExcludedGames` is a pure domain function applied after the popularity filter; free-to-play games are excluded before the price fetcher is ever called
- **Async background jobs** — `LimitedConcurrencyScheduler` queues list-processing jobs in-process with configurable concurrency; on completion it POSTs a callback to any URL the caller provides
- **Game name normalisation** — `clear-string.ts` normalises roman numerals, K-suffixed numbers, edition keywords, DLC tags, regional tags and special characters to maximise match accuracy across different naming conventions
- **Full test suite** — 159 tests (unit + integration) with zero real network or browser calls; integration layer tests the full HTTP pipeline via supertest with vitest mocks at the infrastructure boundary
- **CI/CD** — GitHub Actions runs the full test suite on every pull request; merging to `main` triggers an automatic deploy to the VPS via SSH, rebuilding the Docker image in-place

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 + TypeScript 5 |
| HTTP Server | Express 5 |
| Validation | Zod 4 |
| Scraping | Puppeteer Real Browser + stealth/adblocker plugins |
| HTTP Client | Native fetch (Node.js 22) |
| HTML Parsing | Cheerio |
| Testing | Vitest + Supertest |
| Linting / Formatting | Biome |
| Containerisation | Docker + Xvfb (headless Chromium in Linux containers) |
| CI/CD | GitHub Actions |

---

## Architecture

```
src/
├── routes/            # Thin HTTP routing (method + path only)
├── controllers/       # Request parsing, Zod validation, auth, response shaping
├── schemas/           # Zod schemas + parse helpers
├── application/       # Use cases + port interfaces (dependency inversion)
│   └── games/         #   SearchGamesUseCase, ResearchGamesUseCase
│   │   └── ports/     #   PopularityFetcher, PriceFetcher, GameTradeImporter
│   └── lists/         #   RunListsUseCase, EnqueueRunListsUseCase
├── domain/            # Pure business rules (no Node, no HTTP)
│   └── games/         #   worthyByPopularity, filterExcludedGames
│   └── lists/         #   ListTopic entity
├── infrastructure/    # Concrete adapters implementing port interfaces
│   ├── games/         #   HttpGameTradeImporter
│   ├── background/    #   LimitedConcurrencyScheduler
│   ├── http/          #   AxiosRunListsCallbackPoster
│   └── lists/         #   FetchListTopic (Puppeteer), FormatListResult
├── services/          # Application service orchestration
├── helpers/           # Pure string-transformation utilities (clear-string.ts)
├── lib/               # Shared infrastructure (Puppeteer factory, Disposable)
└── types/             # TypeScript type definitions
```

The `lists` subdomain exposes explicit port interfaces (`ListTopicFetcher`, `BackgroundScheduler`, `RunListsCallbackPoster`, `RunListsRunner`) injected via factory functions — every use case is testable with zero infrastructure.

---

## Getting Started

**Prerequisites:** Node.js ≥ 22, Docker (optional)

```bash
git clone https://github.com/JoaoVitor2310/price-researcher
cd price-researcher
npm install
cp .env.example .env   # fill in your environment variables
npm run dev
```

**With Docker:**
```bash
docker compose up price-researcher-dev
```

**Run tests:**
```bash
npm test
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/games/research` | Research prices for a list of game names (demo or authenticated) |
| `POST` | `/api/games/search` | Search prices and return full analysis JSON |
| `POST` | `/api/games/search-id-steam` | Resolve Steam IDs for a list of games |
| `POST` | `/api/lists/run` | Async: crawl a Steam user's trade lists and run full analysis |

<details>
<summary><strong>POST /api/games/research — request body</strong></summary>

```json
{
  "content": "100\nHalf-Life\nPortal 2\nHades",
  "checkGamivoOffer": true,
  "internal_secret": "optional-token",
  "steam_id": "optional-supplier-steam-id",
  "list_code": "optional-list-identifier"
}
```

The `content` field follows a simple format: **line 1** is the minimum 24h peak player count; every subsequent line is a game name.

**Demo mode response** (no token or wrong token):
```json
{
  "success": true,
  "demo": true,
  "games": [
    { "name": "Half-Life", "price_euro": 1.23, "popularity": 542, "region": "global" }
  ]
}
```

**Authenticated mode response:**
```json
{ "success": true }
```
Results are pushed directly to the inventory system.

</details>

<details>
<summary><strong>POST /api/lists/run — request body</strong></summary>

```json
{
  "id_steam": "76561198000000000",
  "callback_url": "https://your-server.com/callback",
  "checkGamivoOffer": true
}
```

Returns `202 Accepted` immediately. When analysis completes, POSTs to `callback_url`:

```json
{
  "status": "completed",
  "result": "<structured game data>"
}
```

</details>

---

<div align="center">

Built by [João Vitor Gouveia](https://www.linkedin.com/in/jo%C3%A3o-vitor-matos-gouveia-14b71437/) · Personal project · Production use at CarcaDeals

</div>
