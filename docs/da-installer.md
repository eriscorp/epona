# Installing Dark Ages on macOS and Linux

Epona unpacks the official Dark Ages installer itself, so a Mac or a Linux box can
get a client data tree without Windows, Wine or a VM. This document records the
format, the decision behind reading it directly, and what is verified.

Code lives in [src/main/daInstaller/](../src/main/daInstaller/). It imports no
Electron, so a sibling application can take it unchanged.

## There is no external extraction dependency

HTOO-288 asks that any external extraction dependency be documented, "and how it
is installed or bundled for each supported platform". **There is none, and that is
the answer.** Node's built-in `zlib` is the only decompressor involved.

That was not the expected outcome, so the reasoning matters:

- The installer is a **Wise Installation System** package. It is not Inno Setup and
  not NSIS, so `innoextract` cannot read it, and 7-Zip has no Wise handler.
- Wise's payload is **raw DEFLATE with CRC32 checksums**. `zlib.inflateRaw` is a
  complete decompressor for it. What a dedicated tool adds is knowing where each
  stream starts and what it is called, and that information is in the installer's
  own script.

The alternative was bundling [REWise](https://codeberg.org/CYBERDEV/REWise) —
prebuilt for macOS x64/arm64 and Linux x64/arm64, named in the
`electron-builder.yml` `files` allowlist, notarized on macOS, and tracked against
upstream. Reading the format directly costs none of that, works on Windows too,
and puts filename casing under our control, which
[HTOO-287](#casing-is-the-point) needs.

REWise is still owed the credit: it documents the `WiseScript.bin` file-header
struct, and this implementation is written against that description. REWise is
GPL-3.0 and Epona is AGPL-3.0, which are compatible, so a port would have been
permissible too — the choice was technical, not legal.

## The format

A Wise installer is a PE executable — a small stub — with the payload appended
after the last section.

```
┌─────────────────────────────┐ 0
│ PE stub                     │   section table implies where the file ends
├─────────────────────────────┤ overlayOffset        (0x3a00 in the retail file)
│ Wise header                 │   font name, wizard captions; variable length
├─────────────────────────────┤ first stream         (0x3aaa, i.e. +170)
│ WiseColors.dib  + CRC32     │   palette bitmap the wizard draws with
│ WiseScript.bin  + CRC32     │   the install script, including the file table
├─────────────────────────────┤ dataBase             (119392)
│ file data, each + CRC32     │   client files and installer scratch, interleaved
└─────────────────────────────┘
```

Every stream is raw DEFLATE followed by a **4-byte CRC32 of its inflated bytes**.

`WiseScript.bin` is a sequence of one-byte operation codes each followed by a
struct. Operation `0x00` describes a file:

| offset | size | field                                          |
| -----: | ---: | ---------------------------------------------- |
|      0 |    1 | operation code, `0x00`                         |
|      1 |    2 | unknown flags (not always zero)                |
|      3 |    4 | `deflateStart`                                 |
|      7 |    4 | `deflateEnd`                                   |
|     11 |    2 | MS-DOS date                                    |
|     13 |    2 | MS-DOS time                                    |
|     15 |    4 | `inflatedSize`                                 |
|     19 |   20 | unknown (usually but **not always** zero)      |
|     39 |    4 | CRC32, or `0` meaning "not recorded"           |
|     43 |  ... | destination path, NUL-terminated               |

Two things about the offsets that cost real time to establish, because nothing in
the file states either:

- **`deflateStart` is relative to `dataBase`**, the first `0x00` file's data — not
  to the overlay and not to the file. The first entry starts at 0.
- **The span `[deflateStart, deflateEnd)` includes the trailing CRC32.** The
  compressed data is four bytes shorter than the span.

Destination paths use Wise variables as roots. `%MAINDIR%` is the install
directory and the only one holding client files; `%TEMP%` and `%UNINSTALL_PATH%`
are the installer's own plumbing and are skipped.

## Why the parser scans instead of interpreting

Walking the script properly means knowing the length of every operation, and the
format is not fully understood — REWise flags operation `0x18` as unknown, with an
installer-dependent size. One mis-sized operation desynchronises everything after
it.

So [wiseScript.js](../src/main/daInstaller/wiseScript.js) does not try. It scans
every byte offset for something shaped like a `0x00` header and hands the
candidates to [wiseArchive.js](../src/main/daInstaller/wiseArchive.js), which
confirms each one against the installer's own CRC32. False positives are expected
and rejected.

**The CRC32 is what makes this sound.** A candidate at a wrong offset does not
also happen to be followed by four bytes matching its own checksum, and the same
check locates `dataBase`: candidate bases come from the stream chain, and the
right one makes the file table agree. A misparse fails loudly instead of writing
corrupt files.

Consequences worth knowing:

- **Zero-length entries are not extracted.** An entry advertising 0 bytes cannot be
  told from the runs of `0x00` padding the script, and an empty file's CRC32 is
  itself 0 — the same value meaning "not recorded". In the retail installer this
  costs exactly one file, the empty `usa.nfo`, which the client never reads.
- **Unconfirmed entries are reported, not hidden.** `readWiseManifest` returns a
  `skipped` list, and the UI warns when it is non-empty. A silently short tree is
  the failure this design most wants to avoid.

<h2 id="casing-is-the-point">Casing is the point</h2>

The installer writes `Legend.dat`, not `legend.dat`. Folding it breaks lookups on a
case-sensitive filesystem — which is precisely the platform this feature exists
for. Extraction preserves the installer's casing byte for byte, and there is a
test that fails if anything lowercases it. See HTOO-287.

macOS proves nothing here: APFS is case-insensitive by default, so an extraction
that "works" there can still be wrong on Linux. The regression test asserts on a
directory listing rather than on `stat()`, because a `stat` of the wrong case
succeeds on macOS and Windows.

## What is verified

1. **Per file, during extraction** — inflated length equals `inflatedSize`, and
   CRC32 matches the script's value.
2. **Per tree, after extraction** — `verifyClientTree` in
   [daAssets.js](../src/main/daAssets.js) checks the archives a real installation
   always has. This extends `inspectAssetDir` rather than adding a second answer
   to the same question: `inspectAssetDir` stays the lenient shape check the folder
   picker uses, and this is the strict one, for the moment straight after an
   extraction where we know what we wrote.

Output is **staged**, never written straight into the destination. Files land in a
sibling `.epona-incomplete-<pid>` directory and are promoted by rename only once
every entry has passed. A failed or cancelled run removes the staging directory and
leaves the destination untouched — otherwise a half-written tree with a few `.dat`
files in it is exactly the shape `inspectAssetDir` accepts.

## The download

Resolved from [darkages.com](https://www.darkages.com/download/client.html) at run
time, so a version bump needs no Epona release, with the last known URL pinned as a
fallback. The `DarkAges\d+single\.exe` pattern deliberately excludes the
incremental `patch` installers listed on the same page — a patch is not a usable
source tree.

KRU serve it from S3 with `ETag`, `Last-Modified` and range support, which is what
makes the rest work:

- **Resume** via `Range`, with a restart if the server ignores it. Appending a full
  body onto a partial file would produce something longer that looks complete.
- **Reuse** when a complete file's recorded validators still match the server.
- **No partial mistaken for valid** — bytes go to a `.part` file, promoted only
  after the transfer delivers exactly the advertised length.

The cache lives under `installer-cache/` in Epona's data directory, not the OS temp
folder, so resume survives a reboot.

## Measured against the retail installer

`DarkAges741single.exe`, 208,513,633 bytes, `Last-Modified` 2016-04-01:

| Property                | Value                                     |
| ----------------------- | ----------------------------------------- |
| Overlay offset          | `0x3a00` (14848)                          |
| First stream            | 15018 (`0x3aaa`), 170 bytes into overlay  |
| `dataBase`              | 119392                                    |
| Entries found           | 104                                       |
| Client files            | 101, including all 21 `.dat` archives     |
| Unconfirmed             | 0                                         |
| Extracted size          | 582.5 MiB                                 |
| Manifest read           | ~30 ms                                    |

The tests do not use this file. They build a synthetic installer instead — see
[wiseFixture.js](../src/main/daInstaller/wiseFixture.js) — because a 208 MB
download cannot live in the repository, and because the cases worth covering
(truncated payload, checksum mismatch, a path trying to escape the tree) are ones
the retail installer does not contain.
