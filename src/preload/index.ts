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
    action: (repoPath: string, action: 'pull' | 'push') => ipcRenderer.invoke('repositories:git-action', repoPath, action)
  },
  history: { list: () => ipcRenderer.invoke('history:list') }
})
