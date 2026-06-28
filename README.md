# FINKI Hub / Services Scraper

Tooling for scraping and providing publicly available data from FCSE services. The data is provided using a REST API or webhooks. Requires Node.js 24+.

## Architecture

The scrapers are implemented as classes (called strategies) which contain several selectors and methods for fetching the data from each container (post, announcement, etc). Adding a new service requires creating a new strategy and linking it. See [the example strategy](./src/strategies/ExampleStrategy.ts) for more info.

## Quick Setup (Production)

To run the scraper:

1. Clone the repository: `git clone https://github.com/finki-hub/services-scraper.git`
2. Prepare configuration by copying `config/config.sample.json` to `config/config.json`
3. Install dependencies: `npm i`
4. Run the scraper `npm run start`

It's also available as a Docker image:

```sh
docker run -d \
  --name services-scraper \
  --restart unless-stopped \
  -v ./cache:/app/cache \
  -v ./config:/app/config \
  -v ./logs:/app/logs \
  ghcr.io/finki-hub/services-scraper:latest
```

Or Docker Compose: `docker compose up -d`

You can select which scrapers to run declaratively (in the configuration with the `enabled` flag) or imperatively: `npm run start scraper_1 scraper_2 ... scraper_n`

## Quick Setup (Development)

1. Clone the repository: `git clone https://github.com/finki-hub/services-scraper.git`
2. Install dependencies: `npm i`
3. Prepare configuration: `cp config/config.sample.json config/config.json`
4. Build the project: `npm run build`
5. Run it: `npm run start`

## Configuration

There is an example configuration file available at [`config/config.sample.json`](./config/config.sample.json). Copy it to `config/config.json` and edit it to your liking.

### Analytics

PostHog product analytics are wired through environment variables. They are no-ops when `POSTHOG_KEY` is empty (dev/CI/tests emit nothing). Three event types are emitted — all metadata only, no scraped content:

- `scrape_run` — one per iteration: source name, items found/new, duration, success/error status.
- `source_scraped` — one per source per iteration: source name, records added/total, duration, success/error.
- Exception capture — uncaught exceptions: message and stack trace only (Node.js does not serialize frame-local variables).

| Variable       | Default                      | Description                            |
| -------------- | ---------------------------- | -------------------------------------- |
| `POSTHOG_KEY`  | _empty_                      | PostHog project ingest key (public).   |
| `POSTHOG_HOST` | `https://eu.i.posthog.com`   | PostHog Cloud EU ingest host.          |

Analytics require an explicit `POSTHOG_KEY` in the environment; without it the scraper runs silently with no telemetry.

## License

This project is licensed under the terms of the MIT license.
