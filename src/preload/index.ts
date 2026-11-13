import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('repoDesk', {
  version: '0.2.0',
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    chooseRoot: () => ipcRenderer.invoke('settings:choose-root'),
    setDepth: (depth: number) => ipcRenderer.invoke('settings:set-depth', depth),
    setMemo: (repoPath: string, memo: string) => ipcRenderer.invoke('settings:set-memo', repoPath, memo),
    getMemo: (repoPath: string) => ipcRenderer.invoke('settings:get-memo', repoPath),
    setMemoStorage: (mode: 'local' | 'repository') => ipcRenderer.invoke('settings:set-memo-storage', mode),
    setFavorite: (repoPath: string, favorite: boolean) => ipcRenderer.invoke('settings:set-favorite', repoPath, favorite),
    setFrozen: (repoPath: string, frozen: boolean) => ipcRenderer.invoke('settings:set-frozen', repoPath, frozen)
  },
  repositories: {
    scan: () => ipcRenderer.invoke('repositories:scan'),
    refresh: () => ipcRenderer.invoke('repositories:refresh'),
    refreshOne: (repoPath: string) => ipcRenderer.invoke('repositories:refresh-one', repoPath),
    openFolder: (repoPath: string) => ipcRenderer.invoke('repositories:open-folder', repoPath),
    openRemote: (repoPath: string) => ipcRenderer.invoke('repositories:open-remote', repoPath),
    action: (repoPath: string, action: 'pull' | 'push') => ipcRenderer.invoke('repositories:git-action', repoPath, action),
    stage: (repoPath: string, files: string[]) => ipcRenderer.invoke('repositories:stage', repoPath, files),
    unstage: (repoPath: string, files: string[]) => ipcRenderer.invoke('repositories:unstage', repoPath, files),
    diff: (repoPath: string, file: string, staged: boolean) => ipcRenderer.invoke('repositories:diff', repoPath, file, staged),
    commit: (repoPath: string, message: string) => ipcRenderer.invoke('repositories:commit', repoPath, message)
  },
  history: { list: () => ipcRenderer.invoke('history:list') },
  git: { identity: (repoPath?: string) => ipcRenderer.invoke('git:identity', repoPath) },
  documents: {
    list: () => ipcRenderer.invoke('documents:list'),
    save: (document: RepoDeskLibraryDocument) => ipcRenderer.invoke('documents:save', document),
    delete: (id: string) => ipcRenderer.invoke('documents:delete', id),
    publish: (id: string, repoPaths: string[], destination: string, overwrite: boolean) => ipcRenderer.invoke('documents:publish', id, repoPaths, destination, overwrite)
  }
})
