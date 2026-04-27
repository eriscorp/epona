# Hybrasyl Server Launch — Path & Config Resolution

How the Hybrasyl server resolves the path/config inputs Epona feeds it, and what
that means for the launcher.

## Resolution chain (per server flag)

The server (`hybrasyl/Game.cs:174-207`) resolves each input in this order. First
non-empty value wins:

1. **CLI flag** passed by the launcher
2. **Environment variable** (`HYB_*`)
3. **Built-in default**

| Server flag | CLI form | Env fallback | Default |
|---|---|---|---|
| World data dir | `--worldDataDir` / `-w` | `HYB_WORLD_DIR` | `%USERPROFILE%\hybrasyl\world` |
| Data dir | `--dataDir` | `HYB_DATA_DIR` | (paired with world dir) |
| Log dir | `--logDir` | `HYB_LOG_DIR` | (server picks `<repo>/logs`) |
| Config name | `--config` | `HYB_CONFIG_NAME` | `config` |
| Config file path | `--configFile` | `HYB_CONFIG_FILE` | `<worldDataDir>/serverconfigs/<config>.xml` |
| Redis port | `--redisPort` | `HYB_REDIS_PORT` | `6379` |

Run `hybrasyl.exe --help` against a built server to see the full list including
flags Epona doesn't currently use.

The world data dir is **bootstrap-time only** — it can't be in `ServerConfig.xml`
because the XML lives inside it (chicken and egg). A startup validator at
`Game.cs:202-207` refuses to start if the resolved directory doesn't exist. The
resolved value lands in `Game.WorldDataDirectory` (`Game.cs:328`) and is handed
to `XmlDataManager` (`Game.cs:347`).

## What Epona does

Epona always passes CLI flags — never relies on env-var fallbacks for paths:

```js
// src/main/targets/serverTarget.js — buildServerArgs
return [
  '--dataDir', instance.dataDir,
  '--worldDataDir', join(instance.dataDir, 'xml'),
  '--logDir', instance.logDir,
  '--config', stripXmlExt(instance.configFileName)
]
```

Why CLI over env vars:
- CLI is the highest-priority resolution layer, so we override anything the
  user has set in their shell profile.
- Args are visible in the launcher console window's command line, so a user
  troubleshooting can see exactly what was passed.
- We *do* use `HYB_REDIS_*` env vars for Redis overrides since those aren't
  spawn-path-sensitive and the per-server CLI surface is busy enough.

The `--worldDataDir <dataDir>/xml` join is load-bearing: the server has its own
default for `--worldDataDir` independent of `--dataDir`, so omitting it would
make the server look for world data at `%USERPROFILE%\hybrasyl\world` even if
`--dataDir` points elsewhere. Always pass both.

## What about `logDir`?

Worth noting: experimentally the running server places logs at `<repo>/logs`
regardless of `--logDir` / `HYB_LOG_DIR` on some builds — the env-var-set fix
was about the *crash* on missing `HYB_LOG_DIR`, not the placement. Epona's UI
treats `logDir` as display-only and derives it from `dataDir` (since that's
where the user finds them in practice). If a future server build honors
`--logDir` cleanly, the field is already present in settings and we just need
to flip the picker back on.

## What the user picks in Epona

`dataDir` in the per-instance settings should be the **inner repo** (e.g.
`Hybrasyl\world`, `Hybrasyl\ceridwen`) — the one that contains
`xml/serverconfigs/`. The at-pick validator (`isHybrasylDataDir` in
`src/main/serverConfigs.js`) enforces this. Picking the parent
`Hybrasyl\` directory is rejected up front; previously this would silently
fail later when the server's `xml/serverconfigs/` lookup came up empty.
