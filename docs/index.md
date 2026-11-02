qBittorrent adds a tab for viewing and managing the torrents on a self-hosted qBittorrent server.

## Turn it on

You need qBittorrent 5.2 or newer.

1. Install qBittorrent from the Plugins tab.
2. In the qBittorrent WebUI settings, create an API key.
3. In Termix Settings, under qBittorrent, enter the WebUI address as the Termix server reaches it, and the API key.

## Use it

Open the qBittorrent tab from the sidebar. Sort by clicking a column heading, including # for queue position, and narrow the list with the filters and search box.

Select torrents with their checkboxes to start, stop, force start, recheck, reannounce or delete them, or to move them in the queue. The queue buttons are off when queueing is turned off in qBittorrent. A new position can take a few seconds to show.

Click a torrent to see its details, files and trackers.

Add torrents with magnet links or URLs, one per line. If nothing is added, the links may be invalid or the torrents may already be in the list. Uploading `.torrent` files isn't supported.

## Open a torrent's location

Open location shows a torrent's folder in a File Manager tab. It needs the File Manager plugin. An admin sets this up in Settings, under qBittorrent:

- **Downloads host**: the Termix host holding the downloads.
- **qBittorrent path** and **Host path**: set both if the host sees the files at a different path, for example when qBittorrent runs in a container. For example, set `/downloads` and `/mnt/media/downloads`.

Each user needs access to the Termix host.

## Permissions

- **View torrents**: open the tab and see torrents. Admins and users get this by default.
- **Manage torrents**: add, control and reorder torrents. Admins get this by default.
- **Delete torrents**: remove torrents, optionally with their files. Admins get this by default.
