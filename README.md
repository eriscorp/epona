# Epona

A desktop launcher for [Dark Ages](https://www.darkages.com) that patches the game client in-memory at launch. Successor to [Spark](https://github.com/hybrasyl/spark) (C#/.NET), rebuilt on the same Electron + React + MUI stack used by [Creidhne](https://github.com/hybrasyl/creidhne) and [Taliesin](https://github.com/hybrasyl/taliesin).

Built with Electron + React + MUI.

## Features

- **In-memory patching** — patches the DA client process at launch using Win32 kernel32 APIs (`CreateProcess`, `WriteProcessMemory`, `ResumeThread`), no files on disk are modified
- **Server redirect** — point the client at any hostname and port via DNS resolution and address patching
- **Skip intro** — bypass the intro video sequence
- **Multiple instances** — allow more than one client to run simultaneously
- **Hide walls** — toggle wall visibility
- **Auto-detect client version** — MD5 hash detection for 7.37, 7.39, 7.40, and 7.41
- **Server connection tester** — validates server reachability using the DA wire protocol handshake
- **Settings persistence** — all options saved to `%LOCALAPPDATA%\DarkAges\Spark\settings.json`
- **Theme support** — four themes shared with Creidhne and Taliesin (Hybrasyl, Chadul, Danaan, Grinneal)

## Supported client versions

| Version | MD5 hash |
| --- | --- |
| US Dark Ages 7.37 | `36f4689b09a4a91c74555b3c3603b196` |
| US Dark Ages 7.39 | `ca31b8165ea7409d285d81616d8ca4f2` |
| US Dark Ages 7.40 | `9dc6fb13d0470331bf5ba230343fce42` |
| US Dark Ages 7.41 | `3244dc0e68cd26f4fb1626da3673fda8` |

## da-win32

Epona includes `da-win32`, a reusable N-API C++ addon that wraps seven kernel32 functions for Win32 process interop. It lives in `packages/da-win32/` and is designed to be extracted to its own package when other tools (e.g. Taliesin asset injection) need the same capabilities.

| JS function | kernel32 call |
| --- | --- |
| `createSuspendedProcess(path)` | `CreateProcessA` |
| `openProcess(pid, access)` | `OpenProcess` |
| `writeProcessMemory(handle, addr, buf)` | `WriteProcessMemory` |
| `readProcessMemory(handle, addr, size)` | `ReadProcessMemory` |
| `resumeThread(handle)` | `ResumeThread` |
| `suspendThread(handle)` | `SuspendThread` |
| `closeHandle(handle)` | `CloseHandle` |

All handles are exposed as `BigInt` — never coerced to `Number`.

## Installation

Pre-built releases for Windows are available on the [releases page](../../releases).

## Building from source

Requires Visual Studio Build Tools with the C++ workload (for the native addon).

```bash
npm install
npm run rebuild      # compile da-win32 against Electron's Node
npm run dev          # development
npm run build:win    # Windows installer
```

Node.js 18+ required; development is done on Node 24.

## Project structure

| Path | Purpose |
| --- | --- |
| `packages/da-win32/` | Reusable N-API native addon for Win32 process interop |
| `src/main/` | Electron main process — IPC handlers, launcher, server tester |
| `src/preload/` | Context bridge exposing `sparkAPI` to the renderer |
| `src/renderer/src/components/` | UI components — title bar, path picker, options, action buttons |
| `src/renderer/src/themes/` | MUI themes shared with Creidhne and Taliesin |

## Contributing

Issues and pull requests welcome. Please open an issue before starting significant work.

## Author

[Caeldeth](https://github.com/Caeldeth)

## License

See [LICENSE](LICENSE) for details.
