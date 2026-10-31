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
// match for consistency, even though MSBuild accepts either. On macOS and Linux
// the path keeps its forward slashes: MSBuild there converts a backslash path,
// but the path for that OS is the one to write (HTOO-654).
function msbuildPath(p) {
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p
}

// A folder name with `&` or `<` made the file malformed, and restore then
// dropped the reference with no error (HTOO-654).
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// `xmlCsprojAbsPath` null: a file that sets nothing, for a branch worktree that
// builds with the NuGet package (HTOO-646). MSBuild imports the first
// Directory.Build.props it finds above a project, and looks no further unless
// that file imports the next one. A worktree lives at <repo>/.worktrees/<branch>/,
// so with no file of its own it took the repo root's: another instance's local
// XML, or a hand-written UseLocalProtocol.
function renderXml(xmlCsprojAbsPath) {
  if (xmlCsprojAbsPath === null) {
    return [
      '<Project>',
      '  <!-- Written by Epona. It stops MSBuild from importing a Directory.Build.props',
      '       from the repo root, so this worktree builds with the NuGet packages. -->',
      '</Project>',
      ''
    ].join('\r\n')
  }
  const path = escapeXml(msbuildPath(xmlCsprojAbsPath))
  return [
    '<Project>',
    '  <PropertyGroup>',
    '    <UseLocalXml>true</UseLocalXml>',
    `    <LocalXmlProjectPath>${path}</LocalXmlProjectPath>`,
    '  </PropertyGroup>',
    '</Project>',
    ''
  ].join('\r\n')
}

// Writes (or rewrites) the Directory.Build.props file. Idempotent: if the
// file already exists with matching content, the write is skipped so the
// mtime stays stable and we don't trigger a phantom MSBuild rebuild on the
// next dotnet invocation. `xmlCsprojAbsPath` null writes the file that sets
// nothing (renderXml).
export async function writeBuildProps(serverWorktreePath, xmlCsprojAbsPath) {
  if (typeof serverWorktreePath !== 'string' || !serverWorktreePath) {
    throw new Error('writeBuildProps: serverWorktreePath is required')
  }
  if (xmlCsprojAbsPath !== null && (typeof xmlCsprojAbsPath !== 'string' || !xmlCsprojAbsPath)) {
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

// Who currently has a redirect written into which server worktree.
//   serverWorktreePath → Map<ownerId, { xmlCsprojAbsPath, xmlBranchLabel }>
//
// The file itself cannot answer "is somebody else using this?", because it
// records a path and not who asked for it. Two instances on the same server
// branch share one worktree, so the second launch silently rewrote the first
// one's redirect and the first instance's next `dotnet` invocation picked up
// the wrong XML. Nothing errored; the build was just wrong. See HTOO-89.
//
// In-memory on purpose, and it is the same trade worktreeManager's refcounts
// make: state is per-Epona-session, so a redirect left behind by a crash has
// no claimant and is overwritten exactly as before. That is deliberate — a
// guard that outlived the process would turn a crash into a wedged launch that
// only a manual file delete could clear.
const claims = new Map()

// MSBuild path comparison. Both sides come from the same join, so an exact
// match after normalising separators is enough; nothing here invents
// case-folding policy. null is the NuGet package, and matches only itself.
function sameXmlTarget(a, b) {
  if (a === null || b === null) return a === b
  return a.replace(/\\/g, '/') === b.replace(/\\/g, '/')
}

// Claim the redirect for one owner. `xmlCsprojAbsPath` null claims the file
// that sets nothing (HTOO-646): an owner that wants a local XML in the same
// worktree conflicts with it, as two different local XMLs do. Returns { ok: true } when the write may go
// ahead — either nobody holds this worktree, or every holder wants the same
// XML csproj and the file they need is the file we are about to write.
//
// Returns { ok: false, conflict } when a live owner has it pointed somewhere
// else. The caller must not write in that case: the other instance is running
// against this worktree and would silently start building the wrong XML.
export function claimBuildProps(serverWorktreePath, xmlCsprojAbsPath, ownerId, xmlBranchLabel) {
  const owners = claims.get(serverWorktreePath) ?? new Map()
  for (const [id, held] of owners) {
    if (id === ownerId) continue
    if (!sameXmlTarget(held.xmlCsprojAbsPath, xmlCsprojAbsPath)) {
      return { ok: false, conflict: { ownerId: id, ...held } }
    }
  }
  owners.set(ownerId, { xmlCsprojAbsPath, xmlBranchLabel })
  claims.set(serverWorktreePath, owners)
  return { ok: true }
}

// Drop one owner's claim. Returns { last } — true when no other owner holds
// this worktree, which is the caller's signal that removing the file is safe.
// Without that signal, stopping one of two instances sharing a worktree would
// pull the redirect out from under the one still running: the same defect as
// the overwrite, reached from the teardown side instead.
export function releaseBuildProps(serverWorktreePath, ownerId) {
  const owners = claims.get(serverWorktreePath)
  if (!owners) return { last: true }
  owners.delete(ownerId)
  if (owners.size === 0) {
    claims.delete(serverWorktreePath)
    return { last: true }
  }
  return { last: false }
}

// Test-only. Production code releases what it claims; tests want a clean slate
// without threading owner ids through every case.
export function _resetClaimsForTests() {
  claims.clear()
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
