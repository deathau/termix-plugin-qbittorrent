# AGENTS.md

This repo is a [Termix](https://github.com/Termix-SSH/Termix) plugin. These notes are for AI coding tools.

## Read first

Before changing anything, read `node_modules/@termix-ssh/plugin-sdk/PLUGIN-GUIDE.md`. It covers the
manifest, backend, database, frontend, UI, testing, releasing and submitting to the community registry,
and it matches the SDK version installed here. If it is missing, run `npm install`. If it is still missing,
the SDK is older than 1.0.6: run `npm install -D @termix-ssh/plugin-sdk@latest` or read
https://docs.termix.site/develop instead.

If the guide and the SDK's TypeScript types disagree, the types are right.

## First time setup

If `manifest.json` still has the id `hello-world`, this plugin was just made from the template. Ask the
user for the plugin's id, name and description, then:

1. In `manifest.json`, set `id`, `name`, `description`, `author`, `repository`, `docs`, `category`,
   `icon` and `features`. The id is lowercase with dashes and can't change after the first release.
2. Rename every `hello-world`, `hello_world` and `Hello World` to match: `package.json`,
   `locales/en.json`, the index name in `src/backend/tables.ts`, the API paths in `src/backend/routes.ts`,
   the tab id in `src/frontend/index.tsx`, the tests, `docs/index.md`, `CONTRIBUTING.md` and `README.md`.
3. Delete `migrations/` and run `npm run migrations` so the tables use the new id.
4. Replace the example notes feature with the real one, and fill in "About this plugin" below.

## Commands

```bash
npm run build        # bundle into dist/
npm test             # run the tests
npm run typecheck    # type check
npm run validate     # check manifest.json, migrations, changelog and docs
npm run migrations   # write migrations after changing src/backend/tables.ts
npm run pack         # write <id>-<version>.tmxplug
npm run format       # format with Prettier
```

`npx termix-plugin dev --server <url> --key <tmx_...>` installs the plugin on a Termix server with
developer mode on and reinstalls it on every save. Don't start it unless the user asks.

## Layouts and themes

A plugin can also be a layout (`contributes.layouts`, capability `ui:layout`, `app.registerLayout` in the
frontend, shell state from `useShell()`) or add themes (`contributes.themes`, capability `ui:theme`, one CSS
file per theme scoped under `.<id>`). A theme only plugin has no `src/`: just `manifest.json`, `themes/*.css`,
`locales/` and a test that runs `validateThemeCss()`. The guide's "Layouts and themes" section has the rules.

## Done means

- `npm test`, `npm run typecheck`, `npm run validate`, `npm run build` and `npm run format:check` pass
- `npx termix-plugin migrations --check` passes
- New UI text is in `locales/en.json`, new routes have an `@openapi` block and a test
- `docs/` and the section below still match what the plugin does
- User facing changes are in `CHANGELOG.md` under the version they ship in

## About this plugin

Keep this section current when the plugin changes: what it does, how it is put together, decisions that
aren't obvious from the code, and anything that has bitten you before.

- What it does: shows and manages the torrents on one qBittorrent 5.2+ server, set by an admin, using an API key.
  Add by magnet or URL, start, stop, recheck, reannounce, delete, reorder the queue, view details, and open a
  torrent's folder in a File Manager tab.
- How it is put together:
  - `src/backend/qbittorrent/client.ts` talks to qBittorrent and imports nothing from the SDK.
  - `handlers.ts` holds route logic with plain dependencies. `routes.ts` adapts Express and applies permissions.
  - `connection.ts` is the only file touching `ctx.settings` and `ctx.fetch`.
  - `service.ts` and `sync-store.ts` share one `/sync/maindata` poll between all viewers.
  - `src/frontend/torrents.ts` holds the pure helpers, and mirrors the backend's types by hand.
- Conventions:
  - qBittorrent failures are 200 with `ok: false`, because five thrown errors in a minute turn a plugin off. Bad
    input from the browser is a deliberate 400.
  - Hashes are checked against a pattern, which also keeps `all` away from `/torrents/delete`.
- Things that aren't obvious:
  - `.torrent` upload is deliberately absent. `ctx.fetch` is typed `body?: string`, which can't carry binary data.
  - `torrents/add` takes `stopped`, not the wiki's `paused`. It answers 409 when nothing was added, for invalid
    links as well as duplicates, and recent versions answer 200 or 202 with JSON counts rather than `Ok.`.
  - The wiki only shows `torrents/add` as multipart. We send it urlencoded, which qBittorrent's source allows.
  - API-key requests skip qBittorrent's CSRF check, so no Referer header is needed.
  - `priority` is -1 outside the queue, and queue moves answer 409 when queueing is off.
  - `priority` lags after a queue move: qBittorrent reports the new position a few seconds later, and later still
    for stopped torrents. It isn't a failed move. Seen on 5.3.0.
  - `content_path` is empty until a magnet's metadata arrives, and it points into the temporary download folder
    while one is in use.
  - `/torrents/trackers` includes DHT, PeX and LSD placeholders with a negative `tier`.
  - `files.openHost` is the File Manager plugin's action, not an SDK API. If that plugin is off the call does
    nothing and reports nothing, so `useInstalledPlugins` is checked first. Re-check it if File Manager changes.
  - A single-file torrent opens the parent of `content_path`, not `save_path`, because a temporary download folder
    can hold it until it completes.
  - The SDK's tsconfig has `strict: false`, so `if (!body.ok)` doesn't narrow. Write `body.ok === false`.
