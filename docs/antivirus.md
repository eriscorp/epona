# If Windows flags the download

Windows Defender sometimes reports an Epona download as a threat — usually
`Trojan:Win32/Wacatac.C!ml`. SmartScreen sometimes says the publisher is not recognised.

Both are false positives. This page explains why they happen, how to verify that the file you
have is the file we published, and how to report the detection so it stops.

## Why it happens

Epona is signed. Every Windows release is Authenticode-signed with an SSL.com certificate issued
to ERISCO LLC, and since 2.7.2 that covers the whole payload, not only the outer file. A
signature proves who published the file. It does not stop a scanner from disliking what the file
does.

Three things make Epona look unusual to an automatic scanner:

1. **Epona patches the memory of the game client it launches.** That is its main job on Windows.
   It starts `Darkages.exe` suspended, writes to its memory to set the server address and apply
   the options you picked, then resumes it. At the level a scanner sees, this is the same set of
   operations that malware uses to inject code into another program. There is no way to do what
   Epona does without it.
2. **The portable exe unpacks itself before it runs.** It is a self-extracting archive: it writes
   about 99 MB into your temporary folder, runs the app from there, and cleans up on exit. Programs
   that unpack a hidden payload and run it are usually installers — or droppers.
3. **Few people have downloaded it.** Defender weighs how common a file is. Each Epona release is a
   new file that almost nobody has run yet, so there is no history to weigh.

The `!ml` at the end of the detection name means a machine-learning model made the decision, not a
rule that matches known malware. Those verdicts are scored per machine, so the same file can be
flagged on one computer and not on another. Windows 11 machines with Smart App Control turned on
are the strictest.

## Check the file is genuine

Do this before you allow the file. If either check fails, do not run it — tell us instead.

**Check the signature.** In PowerShell, from the folder holding the download:

```powershell
Get-AuthenticodeSignature .\epona-2.7.2-setup.exe | Format-List Status, SignerCertificate
```

`Status` must be `Valid`, and the certificate subject must name `ERISCO LLC`.

**Check the hash.** Every release has a `SHA256SUMS.txt` attached beside the downloads:

```powershell
Get-FileHash .\epona-2.7.2-setup.exe -Algorithm SHA256
```

Compare the result with the line for that filename in `SHA256SUMS.txt`.

**Check the build provenance.** Releases carry a signed record of the workflow run that built
them. With the [GitHub CLI](https://cli.github.com/):

```powershell
gh attestation verify .\epona-2.7.2-setup.exe --repo eriscorp/epona
```

## Get the file back

Defender usually quarantines rather than deletes.

1. Open **Windows Security**.
2. Go to **Virus & threat protection** → **Protection history**.
3. Find the Epona entry, open it, and choose **Actions** → **Allow on device**.
4. Download the file again if it was removed.

If **Smart App Control** blocks it instead, no per-file allowance exists. You can turn Smart App
Control off in **Windows Security** → **App & browser control**, but read Microsoft's warning
first — it cannot be turned back on without reinstalling Windows.

For SmartScreen's "Windows protected your PC" box, choose **More info** → **Run anyway**. Check
the publisher reads `ERISCO LLC` first.

## Report it

Reporting is what actually fixes this, for everyone. Microsoft reviews the file and pushes the
correction to all Defender installations within a few days.

1. Go to <https://www.microsoft.com/en-us/wdsi/filesubmission>.
2. Choose **Software developer** as the submission type.
3. Upload the file and mark it as an **incorrect detection**.
4. Say that the file is Authenticode-signed by ERISCO LLC, and that the program patches the memory
   of a game client it launches, by design.

Please also tell us, in an issue on the repository. Include the exact detection name, your Windows
version, and whether Smart App Control is on. It helps to know which builds get flagged and where.

## Which download to pick

Both Windows downloads are supported, and neither is more genuine than the other:

- **`epona-X.Y.Z-setup.exe`** — the installer. Adds Start menu and desktop entries and installs
  to a fixed folder.
- **`epona-X.Y.Z-portable.exe`** — a single file. Needs no installation and no administrator
  rights. It unpacks itself on each start, so it takes a few seconds longer to open.

If one is flagged, the other may not be. Report whichever one was flagged.

## Related

- [SECURITY.md](../SECURITY.md) — signing and supply-chain posture.
- [docs/release-process.md](release-process.md) — how releases are built and signed.
