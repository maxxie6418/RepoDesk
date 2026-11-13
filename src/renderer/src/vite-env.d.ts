/// <reference types="vite/client" />
interface Window {
  repoDesk: {
    version: string
    window: { minimize: () => Promise<void>; toggleMaximize: () => Promise<void>; close: () => Promise<void> }
    settings: { get: () => Promise<RepoDeskSettings>; chooseRoot: () => Promise<RepoDeskSettings | null>; setDepth: (depth: number) => Promise<RepoDeskSettings>; setMemo: (path: string, memo: string) => Promise<string>; getMemo: (path: string) => Promise<string>; setMemoStorage: (mode: 'local' | 'repository') => Promise<RepoDeskSettings>; setFavorite: (path: string, value: boolean) => Promise<string[]>; setFrozen: (path: string, frozen: boolean) => Promise<string[]> }
    repositories: { scan: () => Promise<{ settings: RepoDeskSettings; repositories: Array<RepoDeskRepository> }>; refresh: () => Promise<{ settings: RepoDeskSettings; repositories: Array<RepoDeskRepository>; checkedAt: string }>; refreshOne: (path: string) => Promise<RepoDeskRepository>; openFolder: (path: string) => Promise<string>; openRemote: (path: string) => Promise<boolean>; action: (path: string, action: 'pull' | 'push') => Promise<boolean>; stage: (path: string, files: string[]) => Promise<string>; unstage: (path: string, files: string[]) => Promise<string>; diff: (path: string, file: string, staged: boolean) => Promise<string>; commit: (path: string, message: string) => Promise<boolean> }
    history: { list: () => Promise<Array<{ id: string; at: string; repository: string; name: string; action: string; result: 'success' | 'failed'; message: string }>> }
    git: { identity: (path?: string) => Promise<{ globalName: string; globalEmail: string; name: string; email: string; source: 'global' | 'repository' }> }
    documents: { list: () => Promise<RepoDeskLibraryDocument[]>; save: (document: RepoDeskLibraryDocument) => Promise<RepoDeskLibraryDocument[]>; delete: (id: string) => Promise<RepoDeskLibraryDocument[]>; publish: (id: string, repoPaths: string[], destination: string, overwrite: boolean) => Promise<{ published: string[]; unchanged: string[]; conflicts: string[] }> }
  }
}
interface RepoDeskSettings { repositoryRoot: string; scanDepth: number; favorites?: string[]; memos?: Record<string, string>; memoStorage?: 'local' | 'repository'; frozen?: string[] }
interface RepoDeskLibraryDocument { id: string; name: string; fileName: string; content: string; updatedAt: string }
interface RepoDeskRepository { name: string; path: string; branch: string; changes: number; staged: number; lastCommit: string; lastCommitAt: string; lastCommitEpoch: number; files: Array<{ path: string; status: string; staged: boolean; unstaged: boolean }>; commits: Array<{ hash: string; subject: string; date: string }>; upstream: string; remoteUrl: string; ahead: number; behind: number; remoteState: 'no-upstream' | 'diverged' | 'ahead' | 'behind' | 'synced' | 'error' | 'frozen' | 'unknown'; remoteError: string; remoteCheckedAt: string; operationState: string; frozen: boolean }
