# FINKI Hub / Services Scraper

Scrapes FCSE services and delivers updates to Discord webhooks. Requires Node.js 26+.

## Architecture

Scrapers are implemented as strategy classes that extract posts from a service. Each configured scraper selects a strategy and supplies its source URL and optional Discord settings. New services are added by creating a strategy and registering it in [`src/utils/strategies.ts`](./src/utils/strategies.ts); see [`ExampleStrategy`](./src/strategies/ExampleStrategy.ts) for the shape.

## Quick start

### Docker

1. Clone the repository and prepare the configuration:
   ```sh
   git clone https://github.com/finki-hub/services-scraper.git
   cd services-scraper
   cp config/config.sample.json config/config.json
   ```
2. Edit `config/config.json`. The sample starts with `sendPosts: false` and empty webhooks; set `sendPosts` to `true` and configure at least one webhook to deliver posts.
3. Start the published image:
   ```sh
   docker compose -f compose.prod.yaml up -d
   ```
   To build locally instead, use `docker compose up -d --build`.

The compose files mount `config/`, `cache/`, and `logs/`. The published image is `ghcr.io/finki-hub/services-scraper:latest`.

### Local

1. `npm ci`
2. `cp config/config.sample.json config/config.json` and edit it.
3. `npm run build`
4. `npm start`

Select scrapers declaratively with each scraper's `enabled` flag, or pass names explicitly:

```sh
npm start -- scraper_1 scraper_2
```

## Configuration

Start from [`config/config.sample.json`](./config/config.sample.json). `config/config.json`, `cache/`, and `logs/` are ignored by Git.

- `credentials`: Required for services that authenticate through CAS; omit it when only public sources are enabled.
- `webhook`: Discord delivery webhook. A scraper-level `webhook` overrides the global one; an empty value disables delivery for that scope.
- `errorWebhook`: Global webhook for error and recovery notices. If empty, errors fall back to the scraper's normal webhook.
- `sendPosts`: Set to `true` after configuring webhooks.
- `maxPosts`, `successDelay`, and `errorDelay`: Optional limits and delays; defaults are in [`src/configuration/defaults.ts`](./src/configuration/defaults.ts).
- `scrapers`: A map of scraper names to `{ strategy, link, enabled, ... }`. Disabled entries are never started.

## Analytics

PostHog analytics are optional and disabled when `POSTHOG_KEY` is empty. Events are metadata-only and contain no scraped content: `scrape_started`, `scrape_run`, `source_scraped`, `notification_sent`, and exception capture. Exception messages and stack traces are not sent. Event properties are defined in [`src/utils/analytics.ts`](./src/utils/analytics.ts).

| Variable       | Default                    | Description                          |
| -------------- | -------------------------- | ------------------------------------ |
| `POSTHOG_KEY`  | _empty_                    | PostHog project ingest key (public). |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` | PostHog Cloud EU ingest host.        |

## Logging

In production (`NODE_ENV=production`), logs are emitted as JSON to stdout and rotated in `logs/` daily or at 10 MB, keeping seven rotated files. The active file is `logs/bot.<n>.log`. Outside production, logs use `pino-pretty` on stdout.

| Variable    | Default | Description                                                                 |
| ----------- | ------- | --------------------------------------------------------------------------- |
| `LOG_LEVEL` | `info`  | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |

## Failure handling

Failing scrapers retry with exponential backoff from `errorDelay`, capped at 15 minutes (or at the configured `errorDelay` when it is larger). Failure state survives a single success and resets after two consecutive successful runs. Error alerts are sent on the first failure of each reason, at most once every six hours per reason, plus one recovery notification after a stable recovery.

## Development

```sh
npm ci
cp config/config.sample.json config/config.json
npm run build
npm start

npm run check   # TypeScript
npm run lint    # ESLint
npm test        # Vitest
npm run format  # ESLint --fix
```

## License

This project is licensed under the terms of the MIT license.
