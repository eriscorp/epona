# Changelog

All notable user-facing changes to Epona are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [Semantic Versioning](https://semver.org/).

<!--
Release process (the notes are authored HERE, not edited on GitHub after the fact):
  1. As you land a PR, add its user-facing change under ## [Unreleased]
     (Added / Changed / Deprecated / Removed / Fixed / Security).
  2. To cut a release: rename ## [Unreleased] to ## [X.Y.Z] - YYYY-MM-DD, add a
     fresh empty ## [Unreleased] above it, and bump package.json to X.Y.Z
     (npm version X.Y.Z --no-git-tag-version).
  3. Tag vX.Y.Z and push. The release workflow runs scripts/changelog-extract.mjs
     to pull THIS version's section into the GitHub release body, then appends the
     auto-generated PR list below it.
Keep entries user-facing — internal refactors/tests show up in the appended auto list.

Write entries in ASD-STE100 Simplified Technical English (asd-ste100.org), like the rest of the
documentation in this repo:
  - One idea per sentence. Keep sentences below about 25 words.
  - Present tense, active voice. Name the actor: "Epona reads the installer", not "the installer
    is read".
  - One term for one thing, through the whole file. Do not reach for a synonym for variety.
  - No idioms, no metaphor, no rhetorical asides. Give the fault, then the behaviour now.
Keep the section order of Keep a Changelog: Added, Changed, Deprecated, Removed, Fixed, Security.
One heading of each kind per version.

Sections before 2.8.0 are in the earlier, more conversational style. They are the text that was
published with those releases, so they stay as they are. 2.8.0 is the first section written to
the rules above.
-->

## [Unreleased]

### Added

- **The Dubhaimid theme.** Dubhaimid is the dark theme with plain controls that the other house apps have. Select it in Settings → Theme.
- **The Shattered and Untamed themes.** Shattered is dark: oxblood bars, a gunmetal page and a steel accent. Untamed is light: deep forest bars over a pale green page, with a leaf-green accent. Select them in Settings → Theme.
- **A theme gallery.** Settings → Theme → Theme gallery shows each control in the theme that you select, with the contrast that it measures. It is for a check by eye. Click Back to go to the tabs again.

### Changed

- **The eight themes use the house colours.** Text, links, the accent colour and the status colours have a contrast of 4.5:1 or more on the page and on the panels, in every theme. Labels on filled controls also have 4.5:1 or more.
- **A selected chip and a status chip show their colour.** Before, each theme drew all chips the same. For example, the chip in What's New that marks the version you run now shows the accent colour.
- **The title bar is the house title bar.** Danaan and Grinneal have a dark bar with light, outlined text. No theme engraves its bar text. The close button turns red under the pointer in every theme. The bar has more space at each end.
- **The client status and the icons on the toolbar below the title bar are easy to read in every theme.** Before, the status text was hard to read on the Danaan, Grinneal and Mundanes toolbars. The toolbar is no longer faded. It has its own colour, a little different from the title bar, so that the two bars are easy to tell apart. While the Settings pane is open, the Settings button has a light background and a ring.
- **A disabled button looks disabled in every theme.** Before, a disabled button kept the accent colour on its text, its icon and its border.
- **An icon shows its own colour.** Before, the Dark Ages themes drew every icon in the accent colour. Now the Log Pane button on the Hybrasyl Client tab shows the accent only while the pane is open, and the tick after a copy in the Help dialog is green. The other icon buttons have the same colour as in Mundanes and Dubhaimid.
- **Visited links are easy to read in every theme.** Before, a visited link, such as the release link of the update check, was hard to read in Hybrasyl and Chadul.

### Removed

- **The Spark theme.** With the house colours, Spark was almost the same as Dubhaimid. If your settings name Spark, Epona opens in Dubhaimid.

### Fixed

- **On macOS and Linux, the Hybrasyl Server tab shows the server's output.** The console button beside the instance list opens the Log Pane for the selected instance. Before, the button was always off, and a failed build or a startup error showed nothing.
- **Epona tells you when a server stops by itself.** When a server exits with an error, or does not start, a notice gives the server's name and its last error line. On macOS and Linux, Show log opens the Log Pane on that server.
- **The Start Server button comes back when a server stops by itself.** Before, on macOS and Linux, the button could stay on Stop Server with no server behind it, and a server that did not start could not be started again until Epona restarted.
- **After a Start, Stop or Reset, the server shows its real state.** Before, a Stop that did not end the server showed the server as stopped, and the next Start failed.
- **Epona cleans up after a server that stops by itself.** Before, on macOS and Linux, the server's worktree and its build settings stayed in use until the next Stop.
- **On macOS and Linux, Stop ends a server that Epona did not start.** Before, Stop on a server that was left running by a crash or a force quit could report success while the server kept its ports.
- **Stop, Reset and Quit give a server time to shut down.** Epona asks the server to stop and waits up to 5 seconds. Then it ends the server by force. When a server does not stop, Stop and Reset show an error, and Epona keeps the server's worktree.
- **Quit stops the Hybrasyl client that runs in repo mode.** Before, the quit question said that Quit stopped the client, but the client kept running. On macOS and Linux, Quit then deleted the client's worktree while the client used it. Quit also removes the build settings that a repo-mode launch writes, and it stops all launches at the same time.
- **A server starts with the Server Config that you select.** Before, Epona gave the server the file name, and the server looks for a config by the name in the file. A config with no name, such as `config.xml`, or a name with different capital letters, such as `local.xml` with the name `Local`, did not start.
- **Epona makes the server's log folder when it does not exist.** Before, the server stopped at once with only its usage text, in repo mode after a full build. Save Log also makes the folder, so a log does not go into the world repo. On macOS, the folder picker has a New Folder button.
- **A server on a branch builds with the XML that its instance names.** Before, a branch instance with no local XML could build with the settings file at the root of the server repo, which can point at another instance's XML.
- **A local XML in a folder with `&` in its name works.** Before, the build ignored the local XML and gave no error.
- **On macOS, a client that needs .NET finds it.** Before, a client app that does not include .NET stopped with "You must install .NET to run this application" when .NET came from Homebrew.
- **On macOS, the Hybrasyl client can be `Brigid.app`.** Before, Epona refused an app bundle with "path is not a file", so binary mode could not run the macOS client from a Brigid release.
- **Epona tells you when the client or a server does not start.** Before, a client that could not start, for example because .NET or the program's execute permission was missing, showed nothing, and a server that could not start could leave the Start Server button on "Starting…". Now an error says why. For a program that needs Rosetta, it says so.
- **On macOS and Linux, Epona refuses a Windows `.exe` as the client, and tells you when the client is not executable.** Before, the `.exe` showed as a valid client and then did not start.
- **A client on a branch runs the code from that branch when its folder is reached through a symbolic link.** Before, it could run the code from the main checkout with no error.
- **Epona tells you when the Dark Ages folder does not exist.** Before, with settings copied from Windows, the client started without its assets and gave no error.
- **On Windows and Linux, Ctrl+R, Ctrl+Shift+I and F11 do nothing.** Before, Ctrl+R reloaded the window and closed the Log Pane, Ctrl+Shift+I opened the developer tools, and F11 put the window in full screen, where it drew wrong.
- **Epona tells you when a Reveal folder button cannot open the folder.** Before, on a Linux desktop with no program for folders, Reveal settings folder, Reveal logs folder and the Report Issue folder button did nothing. Now a notice names the folder.
- **When Epona cannot start, its message names the logs folder of your OS.** Before, it gave the Windows folder on macOS and Linux too.
- **The profile caption on the Hybrasyl Client tab shows the server that the client connects to.** Before, it said "No redirect (official servers)" for a profile with the redirect off, but the client connected to the profile's host. On macOS and Linux, the profile editor no longer shows the redirect checkbox, which applies to the legacy client on Windows only.
- **On macOS and Linux, the toolbar says "Assets Not Found" when the Dark Ages folder does not hold the game files.** Before, it showed any folder that was set as found.
- **On macOS and Linux, Epona's messages name Activity Monitor, Finder, the file manager or `kill`, not Task Manager or Explorer.** On Linux, Stop finds a server with `ss` when `lsof` is not installed. The world folder example shows a path for your OS.
- **On macOS and Linux, a server published as a program, without `.dll`, runs.** Before, Epona ran it through `dotnet`, which failed. A Windows `.exe` is refused with a clear message.
- **Two branches whose names differ only in capital letters get their own worktree folders.** Before, on macOS and Windows they shared one folder, and the launch failed.
- **Epona deletes the Dark Ages installer after a successful install.** Before, the 208 MB download stayed in Epona's settings folder on macOS and Linux.
- **Server and client output keeps letters such as é when the output arrives in pieces.** Before, such a letter could show as two replacement characters.
- **On an Apple Silicon Mac, Epona tells you when a server build needs Rosetta.** Before, the build stopped with exit code 1 and no explanation. Now the log and the notice give the command that installs Rosetta.
- **The labels of the Test Connection, Launch Client, Start Server and Stop Server buttons are easy to read in every theme.** Before, these buttons drew their label in the heading colour, which was hard to read on a filled button.
- **A Stop Server button shows the error colour in the six Dark Ages themes.** Before, it looked the same as the other buttons.

### Security

- **On macOS, an environment variable can no longer load other code into Epona.** Before, the signed app accepted the `DYLD_*` variables, so a library named in `DYLD_INSERT_LIBRARIES` ran inside Epona.
- **Epona runs on Electron 44.10.0.** It has Node 24.22.1, a Node security release, and a newer Chromium.

## [2.9.0] - 2026-10-12

### Added

- **Settings has a Check for updates button.** It is in the About section, below the version. It tells you that Epona is up to date, that a newer version is available (with a link to the release), or why it could not check.
- **On macOS, the title bar holds only the native window buttons.** Before, the bar also showed the Epona logo and name beside the buttons. Now the bar is empty on macOS, as in other Mac apps. The green button does not put the fixed-size window into full screen.
- **On macOS, Epona has its own menu bar.** Before, macOS showed the default Electron menu, with Reload and no Epona commands. Now the menus hold Settings (⌘,), Check for Updates, Locate Assets (⌘O), the folders to reveal, the Log Pane, the three tabs (⌘1 to ⌘3), Recommended Installs, Report an Issue and What's New. A menu command does nothing while a dialog is open.
- **On macOS, Epona tells you when the Xcode Command Line Tools are missing.** Before, a Mac without the tools showed a repo folder as "not a git repository", and each git call could open the system install dialog again. Now Epona shows "Run: xcode-select --install", and it stops calling git until you pick a folder again, click a branch Refresh button, or start a launch.

### Changed

- **Epona reads its version list from the house version manifest.** The update notice read GitHub's releases API before. Now Epona reads one public file that lists the latest version of every house app. The notice now appears 10 seconds after start, not 3 seconds. The close (X) button still hides that version until a newer one is released, and a click elsewhere in the window still does not close the notice.
- **The portable exe shows no image while it unpacks.** The unpack image caused the flash that the Fixed entry below removes. While the portable exe unpacks Epona, Windows now shows a busy cursor for some seconds. The Epona splash then shows as before. The installed version does not unpack and does not change.

### Fixed

- **File and folder pickers open in a useful folder.** A picker with no saved path opened in the operating system's default folder, which is Downloads on Electron 43 and later. Now it opens in the folder you picked last in this session, then in Documents, then in your home folder. A saved path that no longer exists is skipped, so its picker does not fall back to Downloads either.
- **Report an Issue tells you when the copy to the clipboard fails.** Before, the dialog said that the report was on the clipboard, also when the copy failed. Now Epona waits for the copy before it opens the issue page. If the copy fails, the issue page still opens with the report, and the dialog says that the copy failed. If the report is also too long for the page, the dialog tells you to use Copy to clipboard.
- **On the Hybrasyl theme, the accent controls are visible.** The theme used the page background colour as its primary colour, so the scrollbar thumb, the progress bars, the busy spinners and the open log-pane toggle were invisible. These controls now use a blue that is legible against the page.
- **A blank window does not flash when the portable exe closes.** The portable exe showed an image while it unpacked Epona. Because of that image, it also showed its own blank "Setup" window for a moment after the Epona window closed. The portable exe now shows no image, and no window shows after Epona closes. This applies to the title-bar X, Alt+F4, and the taskbar close.
- **A second launch of the portable exe brings the open Epona window to the front.** Each copy of the portable exe unpacked into the same temporary folder, so a second launch tried to overwrite the files of the running copy and showed an "Epona cannot be closed" box. Each launch now unpacks into its own folder. The second launch closes at once, and the open Epona window comes to the front. A second launch also no longer writes to the session logs of the open Epona.
- **The portable exe removes the temporary folders of portable launches that were killed.** The portable exe unpacks Epona into a temporary folder and deletes that folder when Epona closes. If the portable exe itself was killed, for example from Task Manager, that folder stayed, with several hundred MB in it. 30 seconds after it starts, the portable exe now deletes these folders when they are older than 10 minutes and no copy of Epona uses them.
- **On Linux, the splash spinner is round.** With no Segoe UI on Linux, the fallback font made the splash column too tall for its window, and the spinner was squeezed into an oval that wobbled as it turned. The spinner now keeps its size.
- **A quit asks before it stops your repo-mode launches.** Before, Quit from the menu, ⌘Q and Quit from the Dock stopped the running repo-mode servers first, and asked after that, or not at all. Epona now asks first, and Cancel stops nothing. On macOS, closing the window does not ask, because the servers keep running.

### Security

- **Epona runs on Electron 44.** Electron 41 is at its end of life and gets no more Chromium or Node security fixes. Epona moves to Electron 44, the newest stable release.
- **Epona does not start from a changed app archive.** On Windows and macOS, Epona now checks its app archive against a hash that the build records. If the archive changed after the build, Epona does not start.
- **Epona sends its Content-Security-Policy with each page.** The policy was only a tag inside the main page, so it took effect after the page started to load, and the splash had no policy. Epona now attaches the policy to the page response, and the splash has its own narrower policy.

## [2.8.1] - 2026-09-20

### Fixed

- **The window does not flash white when it closes.** The window has a white background behind the page. That background showed for one or two frames when the window closed. Epona now hides the window before it closes. This applies to the title-bar X, Alt+F4, and the taskbar close.
- **The quit confirmation appears when a repo-mode launch is running.** Epona asked the question after the window had already started to close, so the window closed before the question could show. Epona now holds the window, asks the question, and closes the window only after you select Quit. Cancel keeps the window open.
- **Epona removes the temporary folder of an unpack that was killed.** Epona unpacks the client installer into a temporary folder next to the destination. A run that stopped because of a crash or a forced quit left that folder behind, with up to 580 MB in it, and no later run removed it. Each run now removes the temporary folders of runs that are no longer alive.

### Security

- **Epona downloads the client installer only from KRU's own servers over HTTPS.** Epona reads the installer link from the darkages.com download page. It accepted a link to any server, and it accepted plain HTTP. Epona now follows the link only when it points to KRU's S3 bucket or to darkages.com over HTTPS. If it does not, Epona uses the known installer address instead. Epona also stops a download that a redirect sends to another server or to plain HTTP.

## [2.8.0] - 2026-08-11

### Added

- **Epona can unpack the Dark Ages client files on every platform.** The official client installer is a Windows program. You cannot run it on macOS or Linux. Epona reads that installer and writes the client files directly. You do not need Wine, a virtual machine, or any other software. The Legacy Client tab asks where to put the files. You can then download the installer from darkages.com, or select a copy that you have. Epona shows the progress. You can stop the download, and Epona continues it from the same point. Epona compares each file with the checksum in the installer as it writes the file. If a run fails, Epona does not change your folder. When the check is complete, Epona points itself at the new files. On Windows, Epona shows the same controls below the launch controls. On Windows, the official installer stays the usual way to install the game. The official installer records Dark Ages in Windows. Epona does not.
- **Epona tells you when a new version is available.** A few seconds after it starts, Epona asks GitHub for the most recent release. If a newer release exists, Epona shows a small notice with a link to it. If you close the notice, Epona does not show that version again. A later version shows a new notice. Epona downloads and installs nothing. If your machine is offline, behind a proxy, or rate-limited, Epona shows nothing.
- **`EPONA_DISABLE_GPU` sets the Remote Desktop rendering decision.** Set it to `1` to use software rendering on any machine. Set it to `0` to keep hardware acceleration in a session that Epona reads as remote. If you do not set it, Epona decides. There is no control for this in the interface. The variable is for the condition where the automatic decision is wrong on your machine.

### Changed

- **The Legacy Client tab operates on macOS and Linux.** Epona showed the tab in grey, with a message that the legacy client needs Windows. That is correct for the launch function. It is not correct for the Dark Ages files, because the Hybrasyl client reads its graphics and its sounds from those files. The tab now shows your Dark Ages folder. It tells you if it finds the data files there. It also lets you change the folder. Windows does not change.

### Fixed

- **Epona does not write its status checks into a running server's log.** Epona opened a connection to each server every three seconds to find its status. Hybrasyl reads each connection as a player and writes five lines, one of them as an error. A server that ran beside Epona collected these lines continuously. Epona already knew the status of a server that it started. Epona now opens a connection only when it has no other source for the status. Epona still finds a server that started outside Epona.
- **The Remote Desktop adaptation operates when you reconnect to a session.** Windows records how a session started, and it does not change that record. If you connect to a machine that you left in a logged-in condition, Epona read the session as local. The adaptation in 2.7.2 did nothing for the persons who reconnect, and that is most of them. Epona now asks Windows directly, and it gets the correct answer in both conditions.
- **Text is clear over Remote Desktop.** Each theme drew a soft shadow behind every letter. A remote connection cannot send that shadow correctly, and the text looked unsteady. Epona now removes the shadow in a remote session. Epona also uses a simpler letter shape. Nothing changes when you use the machine directly.
- **Epona draws its own icon on Linux.** The application menu showed an empty white page, which is the generic document icon of the desktop. Epona installed one image of 1024 pixels, and no Linux desktop looks for that size. Epona now installs eight standard sizes. Epona also connects its windows to the installed entry. The task bar and the window list now show the icon. Windows and macOS do not change.
- **`localhost` operates as a Legacy profile host name.** The redirect now asks DNS for an IPv4 address only. Before this change, a machine that prefers IPv6 got a client that started and connected to nothing. You had to type `127.0.0.1` instead. That is no longer necessary.
- **Epona does not start the legacy client when it cannot apply the patches.** Before this change, only a failure of the ground-item hints stopped the launch. Any other failure let a partly patched client start. An unresolvable host name is one example.
- **Two server instances on one branch do not compete for the local XML redirect.** Instances on the same server branch use one working copy. If you started a second instance against a different XML branch, Epona changed the build of the first instance. Epona now refuses that launch, and it gives the name of both branches. Two instances that need the same XML branch still use one working copy. If you stop one of them, the redirect stays for the other.

## [2.7.2] - 2026-08-07

### Added

- **Releases now carry `SHA256SUMS.txt` and a build provenance attestation.** If a download is ever flagged, you can check that the bytes you have are the bytes we published.
- **A guide for when Windows flags the download**, at [docs/antivirus.md](docs/antivirus.md). Defender occasionally reports Epona as `Trojan:Win32/Wacatac.C!ml`. It is a false positive — Epona patches the memory of the game client it launches, which is its job and also what a scanner looks for. The guide covers how to verify a download, how to release it from quarantine, and how to report the detection to Microsoft.
- **The Windows installer is documented.** Releases have shipped both `epona-x.y.z-setup.exe` and `epona-x.y.z-portable.exe` for some time, but only the portable exe was mentioned anywhere. Both are supported; pick whichever you prefer.

### Changed

- **Windows downloads are now signed all the way through.** Previously only the outer file carried a signature, so everything the portable exe unpacked was unsigned. Every program file in the download is signed now, including the native addon, and a release cannot be published if any of them is missed.
- **Epona runs properly over Remote Desktop now.** It detects a remote session and adapts on its own — no setting to find. A remote session has no graphics card to use, so Epona stops trying to use one and drops the blur effect behind panels, which is expensive to draw without one. Dragging the window was laggy and the app used noticeable processor time while sitting idle; both are fixed.

### Fixed

- **The window could open far too small over Remote Desktop and refuse to be resized.** Epona sizes itself to fit your screen, but a remote session can report a nonsense screen size for a moment while connecting, and Epona locked itself to it. It now refuses to shrink below a usable size, and re-sizes itself when the screen changes — on reconnecting, or when a monitor is added or removed.

## [2.7.1] - 2026-08-01

### Changed

- **Epona has a proper macOS icon.** The Dock and Finder showed the same square logo Windows uses, which sits oddly among the rounded icons macOS draws beside it. macOS now gets artwork drawn for it, sized to Apple's icon grid.

## [2.7.0] - 2026-08-01

### Added

- **A "What's New" button in Settings → About.** It shows the release notes for the version you are running, with the full history below it — no need to go to GitHub to find out what changed. The notes ship inside the app, so it works offline.

### Changed

- **Epona starts faster, and the splash screen actually shows its logo.** Every place the Epona logo appeared — the splash, the title bar, the Settings header, the window icon — loaded the same 1024×1024, 1.7 MB image, to draw it as small as 20 pixels across. On a cold start that decode landed on the splash's first paint, which is the one thing the splash exists to make fast. Each spot now loads an image sized for what it actually draws.

- **Smaller download and install.** Epona was packaging every user-interface library twice — once compiled into the app, and again as unused source alongside it — and shipping about 12 MB more that nothing at runtime reads, including test-coverage reports and the animated screenshots from the README. Removing all of it cut the application payload from about 138 MB to 6 MB. The download itself shrinks by less, because most of it is the browser engine Epona is built on.

- **The portable build no longer starts in silence.** The portable `.exe` unpacks itself before Epona can draw anything, which took several seconds with no sign it had worked — easy to read as a failed launch and double-click again. It now shows the Epona splash almost immediately, while it unpacks.

- **"Reveal logs folder" moved out of Settings → About.** It is still on the Report an Issue dialog, which is where it is actually useful; the About card now offers What's New in its place.

### Fixed

- **The window is no longer slightly too narrow for its own content.** On a display with Windows scaling above 100%, Epona sized its window ~29px narrower than the layout it had just asked for, so panels, fields and buttons ran off the right edge — and dragging the window wider "fixed" it. Sizing the window and sizing the content used two different coordinate systems, and the limits were applied before the content size instead of after.

- **Epona now fits screens it previously overhung.** The window height was fixed at 800px regardless of the display, which is taller than the usable desktop on a 1080p screen at 125% or 150% scaling — so the bottom of the window sat off the edge. Epona now asks for no more than the screen can show, and the layout adapts to the window it actually gets instead of assuming it got what it asked for.

- **"No client detected" is readable on the Hybrasyl theme.** It was drawn in a muted slate that sat almost invisibly against that theme's teal toolbar. It now uses the theme's cyan, which is also the right signal — a client that has not been located yet is a notice, not an error.

- **Worktrees now work when the repo path is not its canonical form** — a repo reached through a junction, a mapped drive, or a short (8.3) directory name. Epona compared the path you gave against the path git reports, which are not the same string in those cases, so it could not adopt, list or remove the worktrees it had made.

### Security

- **Epona's interface now runs in the operating system's sandbox.** The part of the app that draws the window is confined the way a browser tab is, so a flaw in it cannot reach your files directly — it can only ask the trusted part of Epona, which checks every request.

- **Those requests are now checked for where they came from.** Everything the interface asks Epona to do — read your settings, launch a client, run a git command — is accepted only from Epona's own window showing Epona's own page. Anything else asking is refused.

- **A page on another machine can no longer pose as Epona's own.** That check compared only the file path, so a copy of Epona's page on a network share at a matching path was accepted as the real one — and got everything the real one gets. It now compares the machine as well. A default Windows install was never reachable this way; an install on a network drive was, as were macOS and Linux.

- **The shipped Epona binary can no longer be used to run arbitrary code.** Electron applications ship with developer escape hatches switched on, one of which lets anyone who can set an environment variable turn the signed `Epona.exe` into a general-purpose script interpreter. Those are now switched off.

- **Links now open only if they are web links.** Anything Epona hands to your browser is checked to be `http`, `https` or `mailto` first, and the main window can no longer be navigated away from the app.

- **Epona now runs on Electron 41.10.3**, up from 41.2.0 — eight patch releases of Chromium security fixes that the app was missing. No behavior changes.

- **Build-toolchain dependencies updated** to clear ten advisories, including a credential leak in `electron-builder`'s upload path, a path-traversal bug in `postcss`, and a denial-of-service bug in `brace-expansion`. These affect only how Epona is built, not the app you run.

## [2.6.0] - 2026-07-23

### Added

- **Ground Item Hints** (Legacy client, Dark Ages 7.41 only). Hold either Alt key to draw every visible ground item again as a translucent hint on top of the scene, so items behind a wall or a tree are easy to spot. Release Alt and the hints go away immediately. The option only appears when Epona has identified your client as 7.41 — it installs code into the running client, and the addresses it needs were only mapped for that build. Turning it on also fixes keys sticking down when the game loses focus.

- **Epona now tracks running servers properly.** The Server tab asks the launcher what is actually running instead of remembering what it started: it watches the server process and checks the instance's lobby port. A server you started in an earlier Epona session — or by hand — is picked up and shown as **running (external)**, and you can stop it from Epona.
- **Worktree housekeeping.** When you switch an instance (or the client) to a different branch, Epona offers to remove the old branch's git worktree. It also clears worktrees that no saved setting points at any more, at startup and at quit. Worktrees with uncommitted changes are always kept — only Flush Worktrees discards those, and it still asks first.
- **Settings → Maintenance lists your managed worktrees**, with the branch, the path, a "dirty" mark, and a Remove button for each.
- **An installer.** Windows releases now ship an NSIS setup .exe next to the portable build.

### Fixed

- **Picking a specific client version no longer stops your settings from saving.** Choosing a version instead of leaving it on Auto wrote a value the settings validator rejected, so that change — and every change after it — was silently dropped.
- **Only one Epona runs at a time.** A second launch focuses the window you already have. Two copies used to fight over the same settings and cache folder, and neither one could see the servers the other had started.
- **A server that stops on its own no longer shows as running.** Closing the server's console window now updates the button and releases the git worktree that launch was holding.
- **The taskbar shows the Epona icon and name** instead of a generic Electron one. The running window advertised a different app ID than the installer registered.
- **Builds no longer carry Epona's own development files** — the packaged app shipped the test suites, coverage reports, and internal notes inside itself.
- **The splash window can't get stuck.** It now appears even if the window-ready signal never arrives, and it closes itself if the app fails to start, instead of floating on top of everything with no way to close it.

## [2.5.0] - 2026-07-12

### Added

- **Mundanes light theme** — a flat, "corporate" light theme sitting alongside the four dark fantasy themes (Hybrasyl, Chadul, Danaan, Grinneal). On the plain themes the window chrome switches to flat standard controls instead of the stylized fantasy glyphs.
- **About section in Settings** — shows the app version and readable links to hybrasyl.com and the GitHub repo (legible on every theme, including the dark ones where they used to nearly vanish).
- **Flush Worktrees** maintenance action (Settings → Maintenance) — force-clears Epona-managed git worktrees for your configured repos. Use it when a repo-mode launch wedges with a "worktree already exists" error. It confirms first, since it discards uncommitted work inside those managed worktrees.

### Changed

- **Restyled title bar** — the logo and app title are now left-aligned, and the plain themes get flat window controls to match their look.
- **Settings reorganized into single-open collapsible sections** — one section is expanded at a time, so the pane stays compact instead of scrolling a long form.
- **Console / log output is now selectable** for copy-paste.

### Fixed

- **The Settings pane no longer nudges the UI when it opens.** Two separate breakpoint glitches are gone: the content/title indent (MUI toolbar gutters flipping as the window widened past 600px) and the Epona title changing font size on open. The window also no longer leaves a left-side gap when a side pane opens — the frameless resize was reworked to stop shifting the client area.
- **Repo-mode launches recover instead of wedging.** Flush Worktrees now actually flushes (it was silently doing nothing), and the launcher prunes stale worktree registrations and adopts/repairs a pre-existing worktree rather than failing with "already exists".
- **The distributed Hybrasyl client `.exe` now launches correctly.**
- About links are readable on every theme.

### Under the hood

- Added an end-to-end test harness (Playwright + Electron) that drives the built app, so window/layout regressions like the ones above are caught by measurement rather than by eye.
- A round of code-health refactors across the main and renderer processes (extracted the settings sections, shared the dotnet-runtime/branch logic, made the child-process log piping unit-testable) — see the full commit list below.
