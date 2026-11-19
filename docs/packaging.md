# Packaging

- `app/data/` — metainfo, desktop file and icons. Translations sit inline (`xml:lang`, `Name[de]`).
  Validate: `appstreamcli validate --pedantic --no-net app/data/eu.jumplink.Reminder.metainfo.xml`
  and `desktop-file-validate app/data/eu.jumplink.Reminder.desktop`. The pedantic
  `cid-contains-uppercase-letter` note is expected: the app ID is fixed.
- `app/dev/screenshots.sh` — listing screenshots from the demo data into `docs/screenshots/`.
  TODO: Calendar and Board are placeholders, so they have no motif yet.
- `eu.jumplink.Reminder.json` — Flatpak manifest on the GNOME 50 runtime. Evolution Data Server is
  NOT bundled in this version, so the GNOME-calendar backend degrades to CalDAV only inside the
  sandbox. `gjsify-sources.json` is the offline npm cache; regenerate it after any lockfile change:
  `gjsify flatpak sources --focus reminder-cli --out gjsify-sources.json`.
