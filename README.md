<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>Termix qBittorrent Plugin</h1>

<p>View and manage the torrents on a self-hosted qBittorrent server from Termix</p>

</div>

<br />

## Overview

[Termix](https://github.com/Termix-SSH/Termix) is self-hosted, plugin-based server management. This plugin adds a tab for a qBittorrent 5.2+ server, connected with an API key. See [the docs](docs/index.md) for setup and use.

<br />

## Features

- Add torrents from magnet links and URLs
- Sort by name, progress, queue position and more, and filter by state
- Start, stop, force start, recheck, reannounce and delete torrents
- Move torrents in the queue
- View a torrent's details, files and trackers
- Open a torrent's folder in a File Manager tab on a chosen Termix host
- Separate view, manage and delete permissions

<br />

## Development

You need Node 24 and a Termix server you are an admin on. The full guide is at [docs.termix.site/develop](https://docs.termix.site/develop).

1. Install the packages with `npm install`.
2. In Termix, open Settings, then General, and turn on Plugin developer mode. Then make an API key under Settings, API keys.
3. Build and install the plugin on your server. It rebuilds and reinstalls every time you save a file:

   ```bash
   npx termix-plugin dev --server http://localhost:30001 --key tmx_your_key
   ```

4. Run the checks before you push:

   ```bash
   npm test
   npm run typecheck
   npm run validate
   npm run build
   npm run format:check
   ```

<br />

## Releasing

Work happens on a `dev-X.Y.Z` branch made from `main`, named after the version it will ship as. `main` only changes when a release merges a dev branch into it.

Run the Release workflow by hand from the dev branch:

- beta publishes `X.Y.Z-beta.N` (N counts up on its own). Termix only offers it to people who turned on Beta versions for this plugin. Run it as often as you like.
- stable releases `X.Y.Z`, merges the dev branch into `main`, deletes the dev branch and removes that version's beta releases. Add a `## X.Y.Z` section to `CHANGELOG.md` first, it becomes the release notes.
- overwrite releases the manifest version again from the current commit, replacing its files.
- dry-run builds and packs without publishing anything.

No secrets are needed. The workflow records GitHub build provenance for the `.tmxplug` so the community registry can check where it was built. If a dev branch changes files in `.github/workflows`, add a `TERMIX_PAT` secret (a token with `repo` and `workflow` scopes) so the release can push it to `main`.

## Submitting to the community registry

Once a version is released, you can submit it to the [Termix community registry](https://github.com/Termix-SSH/Termix-Registry). The Release run's summary shows the `sha256` to put in your submission. Every version is reviewed by a person before it is listed. See the [guide](https://docs.termix.site/develop/community-registry).

Once it is listed, admins who turn on the community registry in Plugins, Registries can install it from Browse.

## Sponsors

For a paid sponsor spot, email [mail@termix.site](mailto:mail@termix.site).

<!-- SPONSORS:START -->

<div align="center">

<br />

<a href="https://www.blacksmith.sh/">
  <img src="https://termix.site/img/sponsors/blacksmith.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://termix.site/img/sponsors/cloudflare.png" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://termix.site/img/sponsors/akamai.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://termix.site/img/sponsors/aws.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://termix.site/img/sponsors/rackgenius.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://termix.site/img/sponsors/ginernet.png" height="40" alt="Ginernet" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.hetzner.com/?mtm_campaign=termix&mtm_medium=referral&mtm_content=sponsoring_link">
  <img src="https://termix.site/img/sponsors/hetzner.png" height="40" alt="Hetzner" />
</a>

</div>

<!-- SPONSORS:END -->

<br />

## Support

Bugs and ideas for the template go in this repo: [report a bug](https://github.com/Termix-SSH/Termix-Plugin-Template/issues/new?template=bug_report.yml) or [request a feature](https://github.com/Termix-SSH/Termix-Plugin-Template/issues/new?template=feature_request.yml).

Problems with Termix itself (login, hosts, credentials, sharing, sync) go in the [Termix repo](https://github.com/Termix-SSH/Termix/issues/new/choose). Not sure where it goes? Open it there and it will be moved.

Add as much detail as you can, in English if possible. For questions about building plugins, join the [Discord](https://discord.gg/jVQGdvHDrf) server.

<br />

## License

Apache License 2.0. See [LICENSE](LICENSE).
