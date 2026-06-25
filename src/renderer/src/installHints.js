// Per-OS install guidance for the optional dependencies Epona can use. Windows
// uses winget; macOS uses Homebrew; Linux shows Debian/Ubuntu apt. Centralized
// so the Help dialog and the inline "git not found" hints stay consistent and
// never tell a non-Windows user to run a winget command.

const COMMANDS = {
  win32: {
    git: 'winget install --id Git.Git -e --source winget',
    redis: 'winget install Memurai.MemuraiDeveloper',
    dotnetSdk: 'winget install --id Microsoft.DotNet.SDK.10 -e',
    dotnetRuntime: 'winget install --id Microsoft.DotNet.Runtime.10 -e'
  },
  darwin: {
    git: 'brew install git',
    redis: 'brew install redis',
    dotnetSdk: 'brew install dotnet',
    dotnetRuntime: 'brew install dotnet'
  },
  linux: {
    git: 'sudo apt install git',
    redis: 'sudo apt install redis-server',
    dotnetSdk: 'sudo apt install dotnet-sdk-10.0',
    dotnetRuntime: 'sudo apt install aspnetcore-runtime-10.0'
  }
}

function commandsFor(platform) {
  return COMMANDS[platform] ?? COMMANDS.linux
}

// Inline "git not detected" hint used by the client/server repo pickers.
export function gitInstallHint(platform) {
  return `Install: ${commandsFor(platform).git} (then restart Epona).`
}

// Redis install command for the server panel's Redis hint.
export function redisInstallCommand(platform) {
  return commandsFor(platform).redis
}

// Rows for the "Recommended installs" help dialog. Redis is Memurai (a native
// Windows Redis) on Windows; plain Redis elsewhere.
export function installItems(platform) {
  const c = commandsFor(platform)
  const redis =
    platform === 'win32'
      ? {
          name: 'Memurai Developer',
          why: 'Native Windows Redis-compatible server. Use this instead of WSL Redis to avoid the WSL2 localhost-forwarding stalls Hybrasyl server hits on launch.'
        }
      : {
          name: 'Redis',
          why: 'Redis-compatible server backing the Hybrasyl server data store.'
        }
  const items = [
    { key: 'redis', name: redis.name, why: redis.why, command: c.redis },
    {
      key: 'git',
      name: 'Git',
      why: 'Required for repo-mode launches with branch switching. Without git, repo-mode still works but Epona launches directly from the picked folder with no branch picker.',
      command: c.git
    }
  ]
  // On macOS the SDK and runtime are the same Homebrew formula, so show one row;
  // Windows/Linux split them (the runtime is a separate, smaller install).
  if (platform === 'darwin') {
    items.push({
      key: 'dotnet',
      name: '.NET 10 SDK',
      why: "Required for repo-mode launches (`dotnet run` compiles first) and to run prebuilt .dll artifacts. Homebrew's dotnet formula installs the SDK, which includes the runtime.",
      command: c.dotnetSdk
    })
  } else {
    items.push(
      {
        key: 'dotnet-sdk',
        name: '.NET 10 SDK',
        why: 'Required for repo-mode launches — `dotnet run` compiles the project before running. The runtime alone is not enough for source launches.',
        command: c.dotnetSdk
      },
      {
        key: 'dotnet-runtime',
        name: '.NET 10 Runtime',
        why: 'Required to run a prebuilt Hybrasyl client or server. Self-contained builds bundle their own runtime. Included with the SDK above.',
        command: c.dotnetRuntime
      }
    )
  }
  return items
}

// Platform-specific intro line for the help dialog.
export function installIntro(platform) {
  if (platform === 'win32') {
    return 'Copy a command and paste into PowerShell. winget ships with Windows 10 1809+ and Windows 11. Restart Epona after installing so the new PATH is picked up.'
  }
  if (platform === 'darwin') {
    return 'Copy a command and paste into Terminal. These use Homebrew (brew.sh). Restart Epona after installing.'
  }
  return 'Copy a command and paste into a terminal (Debian/Ubuntu apt shown; .NET 10 may need the Microsoft package feed). Restart Epona after installing.'
}
