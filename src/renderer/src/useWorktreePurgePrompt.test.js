import { describe, it, expect } from 'vitest'
import { findWorktreeForBranch } from './useWorktreePurgePrompt.js'

const managed = [
  { repo: '/srv', branch: 'main', path: '/srv/.worktrees/main', dirty: false, refcount: 0 },
  { repo: '/srv', branch: 'feature/foo', path: '/srv/.worktrees/feature__foo', dirty: true }
]

describe('findWorktreeForBranch', () => {
  it('finds the worktree a branch owns', () => {
    expect(findWorktreeForBranch(managed, 'feature/foo')?.path).toBe('/srv/.worktrees/feature__foo')
  })

  it('returns null when the branch has no worktree', () => {
    expect(findWorktreeForBranch(managed, 'develop')).toBe(null)
  })

  it('returns null for the "no pinned branch" values', () => {
    // null = current checkout / NuGet XML, '' = local XML in place. Neither owns
    // a worktree, so switching away from one must not prompt.
    expect(findWorktreeForBranch(managed, null)).toBe(null)
    expect(findWorktreeForBranch(managed, '')).toBe(null)
  })

  it('copes with a missing listing', () => {
    expect(findWorktreeForBranch(undefined, 'main')).toBe(null)
  })
})
