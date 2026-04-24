import { promises as fs } from 'fs'
import { join } from 'path'

// Manages the gitignored Directory.Build.props at the server worktree root.
// MSBuild auto-imports this file from the project's ancestor directories,
// so writing it next to the .csproj is enough to flip the conditional
// PackageReference / ProjectReference in hybrasyl/Hybrasyl.csproj over to
// the local XML worktree. The conditional itself lives in the server repo
// (commit 11bc748 on feature/epona-branch-instances). See
// docs/stage-3.1-branch-aware-repo-plan.md for the design.

const FILE_NAME = 'Directory.Build.props'

// MSBuild on Windows prefers backslashes in path properties. The design doc
// in the server repo (docs/epona-branch-instances.md) shows backslashes; we
// match for consistency, even though MSBuild accepts either.
function toWindowsPath(p) {
  return p.replace(/\//g, '\\')
}

function renderXml(xmlCsprojAbsPath) {
  const winPath = toWindowsPath(xmlCsprojAbsPath)
  return [
    '<Project>',
    '  <PropertyGroup>',
    '    <UseLocalXml>true</UseLocalXml>',
    `    <LocalXmlProjectPath>${winPath}</LocalXmlProjectPath>`,
    '  </PropertyGroup>',
    '</Project>',
    ''
  ].join('\r\n')
}

// Writes (or rewrites) the Directory.Build.props file. Idempotent: if the
// file already exists with matching content, the write is skipped so the
// mtime stays stable and we don't trigger a phantom MSBuild rebuild on the
// next dotnet invocation.
export async function writeBuildProps(serverWorktreePath, xmlCsprojAbsPath) {
  if (typeof serverWorktreePath !== 'string' || !serverWorktreePath) {
    throw new Error('writeBuildProps: serverWorktreePath is required')
  }
  if (typeof xmlCsprojAbsPath !== 'string' || !xmlCsprojAbsPath) {
    throw new Error('writeBuildProps: xmlCsprojAbsPath is required')
  }
  const filePath = join(serverWorktreePath, FILE_NAME)
  const next = renderXml(xmlCsprojAbsPath)
  try {
    const current = await fs.readFile(filePath, 'utf-8')
    if (current === next) return { written: false, path: filePath }
  } catch {
    // File missing — fall through to write
  }
  await fs.writeFile(filePath, next, 'utf-8')
  return { written: true, path: filePath }
}

// Removes Directory.Build.props from the server worktree root. Idempotent —
// missing file is a no-op. Called when an instance with xmlBranch is torn
// down so the worktree falls back to the NuGet PackageReference for the
// next launch.
export async function removeBuildProps(serverWorktreePath) {
  if (typeof serverWorktreePath !== 'string' || !serverWorktreePath) {
    throw new Error('removeBuildProps: serverWorktreePath is required')
  }
  const filePath = join(serverWorktreePath, FILE_NAME)
  try {
    await fs.unlink(filePath)
    return { removed: true, path: filePath }
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: false, path: filePath }
    throw err
  }
}
