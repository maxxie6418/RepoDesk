/// <reference types="vite/client" />
interface Window {
  repoDesk: {
    version: string
    window: { minimize: () => Promise<void>; toggleMaximize: () => Promise<void>; close: () => Promise<void> }
    settings: { get: () => Promise<RepoDeskSettings>; chooseRoot: () => Promise<RepoDeskSettings | null>; setDepth: (depth: number) => Promise<RepoDeskSettings>; setMemo: (path: string, memo: string) => Promise<string>; getMemo: (path: string) => Promise<string>; setMemoStorage: (mode: 'local' | 'repository') => Promise<RepoDeskSettings>; setFavorite: (path: string, value: boolean) => Promise<string[]>; setFrozen: (path: string, frozen: boolean) => Promise<string[]> }
    repositories: { scan: () => Promise<{ settings: RepoDeskSettings; repositories: Array<RepoDeskRepository> }>; refresh: () => Promise<{ settings: RepoDeskSettings; repositories: Array<RepoDeskRepository>; checkedAt: string }>; refreshOne: (path: string) => Promise<RepoDeskRepository>; openFolder: (path: string) => Promise<string>; action: (path: string, action: 'pull' | 'push') => Promise<boolean> }
    history: { list: () => Promise<Array<{ id: string; at: string; repository: string; name: string; action: string; result: 'success' | 'failed'; message: string }>> }
  }
}
interface RepoDeskSettings { repositoryRoot: string; scanDepth: number; favorites?: string[]; memos?: Record<string, string>; memoStorage?: 'local' | 'repository'; frozen?: string[] }
interface RepoDeskRepository { name: string; path: string; branch: string; changes: number; staged: number; lastCommit: string; lastCommitAt: string; lastCommitEpoch: number; files: Array<{ path: string; status: string }>; commits: Array<{ hash: string; subject: string; date: string }>; upstream: string; ahead: number; behind: number; remoteState: 'no-upstream' | 'diverged' | 'ahead' | 'behind' | 'synced' | 'error' | 'frozen' | 'unknown'; remoteError: string; frozen: boolean }
