import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, basename, relative, isAbsolute } from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const settingsPath = () => join(app.getPath('userData'), 'settings.json')
const historyPath = () => join(app.getPath('userData'), 'operations.json')
type OperationRecord = { id: string; at: string; repository: string; name: string; action: string; result: 'success' | 'failed'; message: string }
async function appendHistory(record: OperationRecord) {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  let records: OperationRecord[] = []
  try { records = JSON.parse(await fs.readFile(historyPath(), 'utf8')) } catch { /* first entry */ }
  records.unshift(record)
  await fs.writeFile(historyPath(), JSON.stringify(records.slice(0, 500), null, 2), 'utf8')
}
type Settings = { repositoryRoot: string; scanDepth: number; favorites?: string[]; memos?: Record<string, string>; memoStorage?: 'local' | 'repository'; frozen?: string[] }
async function readSettings(): Promise<Settings> {
  try { return { scanDepth: 2, favorites: [], memos: {}, memoStorage: 'local', frozen: [], ...JSON.parse(await fs.readFile(settingsPath(), 'utf8')) } }
  catch { return { repositoryRoot: '', scanDepth: 2, favorites: [], memos: {}, memoStorage: 'local', frozen: [] } }
}
async function writeSettings(settings: Settings) {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}
async function resolveRepositoryPath(candidate: string, settings: Settings) {
  if (!settings.repositoryRoot) throw new Error('请先在设置中配置项目根目录。')
  const root = await fs.realpath(settings.repositoryRoot)
  const repo = await fs.realpath(candidate)
  const rel = relative(root, repo)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('该项目不在当前扫描目录内。')
  await fs.access(join(repo, '.git'))
  return repo
}
const memoStart = '<!-- RepoDesk memo:start -->'
const memoEnd = '<!-- RepoDesk memo:end -->'
async function readRepositoryMemo(repoPath: string) {
  let content = ''
  try { content = await fs.readFile(join(repoPath, 'list.md'), 'utf8') } catch { return '' }
  const start = content.indexOf(memoStart)
  const end = content.indexOf(memoEnd)
  if (start < 0 || end < start) return ''
  return content.slice(start + memoStart.length, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '')
}
async function writeRepositoryMemo(repoPath: string, memo: string) {
  const file = join(repoPath, 'list.md')
  let content = ''
  try { content = await fs.readFile(file, 'utf8') } catch { /* create it on first save */ }
  const block = `${memoStart}\n${memo.trim()}\n${memoEnd}`
  const start = content.indexOf(memoStart)
  const end = content.indexOf(memoEnd)
  if (start >= 0 && end >= start) content = content.slice(0, start) + block + content.slice(end + memoEnd.length)
  else content = `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${block}\n`
  await fs.writeFile(file, content, 'utf8')
}
async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
  return stdout.trim()
}
async function scanRepositories(root: string, maxDepth: number) {
  const repos: Array<{ name: string; path: string; branch: string; changes: number; staged: number; lastCommit: string; lastCommitAt: string; lastCommitEpoch: number; files: Array<{ path: string; status: string }>; commits: Array<{ hash: string; subject: string; date: string }>; upstream: string; ahead: number; behind: number; remoteState: string; remoteError: string; frozen: boolean }> = []
  const ignored = new Set(['node_modules', '.npm', '.cache', 'dist', 'build', 'coverage', 'vendor'])
  async function walk(dir: string, depth: number): Promise<void> {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    if (entries.some(entry => entry.name === '.git')) {
      try {
        const [branch, status, lastCommit, lastCommitAt, lastCommitEpoch, log] = await Promise.all([
          git(dir, ['branch', '--show-current']).then(value => value || '(detached)'),
          git(dir, ['status', '--porcelain=v1']),
          git(dir, ['log', '-1', '--pretty=%s']).catch(() => ''),
          git(dir, ['log', '-1', '--pretty=%cr']).catch(() => ''),
          git(dir, ['log', '-1', '--pretty=%ct']).then(Number).catch(() => 0),
          git(dir, ['log', '-5', '--pretty=%h%x1f%s%x1f%cr']).catch(() => '')
        ])
        const statusLines = status.split(/\r?\n/).filter(Boolean)
        const files = statusLines.map(line => ({ path: line.slice(3), status: line.slice(0, 2).trim() || '未跟踪' }))
        const commits = log.split(/\r?\n/).filter(Boolean).map(line => { const [hash, subject, date] = line.split('\x1f'); return { hash, subject, date } })
        const upstream = await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')
        const counts = upstream ? await git(dir, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).catch(() => '') : ''
        const [aheadRaw, behindRaw] = counts.split(/\s+/)
        const ahead = Number(aheadRaw) || 0
        const behind = Number(behindRaw) || 0
        repos.push({ name: basename(dir), path: dir, branch, changes: files.length, staged: statusLines.filter(line => line[0] !== ' ' && line[0] !== '?').length, lastCommit, lastCommitAt, lastCommitEpoch, files, commits, upstream, ahead, behind, remoteState: !upstream ? 'no-upstream' : ahead && behind ? 'diverged' : ahead ? 'ahead' : behind ? 'behind' : 'synced', remoteError: '', frozen: false })
      } catch { /* invalid or unavailable repositories are omitted from this first scan */ }
      return
    }
    if (depth >= maxDepth) return
    await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name.toLowerCase())).map(entry => walk(join(dir, entry.name), depth + 1)))
  }
  if (root) await walk(root, 0)
  return repos.sort((a, b) => a.name.localeCompare(b.name))
}

async function refreshRemoteStates() {
  const settings = await readSettings()
  const repos = await scanRepositories(settings.repositoryRoot, settings.scanDepth)
  const frozen = new Set(settings.frozen || [])
  for (const repo of repos) if (frozen.has(repo.path)) { repo.frozen = true; repo.remoteState = 'frozen' }
  let cursor = 0
  const workers = Array.from({ length: Math.min(3, repos.length) }, async () => {
    while (cursor < repos.length) {
      const repo = repos[cursor++]
      if (frozen.has(repo.path)) continue
      try {
        await git(repo.path, ['fetch', '--prune'])
        const upstream = await git(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')
        repo.upstream = upstream
        if (!upstream) { repo.remoteState = 'no-upstream'; continue }
        const counts = await git(repo.path, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
        const [aheadRaw, behindRaw] = counts.split(/\s+/)
        repo.ahead = Number(aheadRaw) || 0
        repo.behind = Number(behindRaw) || 0
        repo.remoteState = repo.ahead && repo.behind ? 'diverged' : repo.ahead ? 'ahead' : repo.behind ? 'behind' : 'synced'
        await appendHistory({ id: `${Date.now()}-${repo.path}`, at: new Date().toISOString(), repository: repo.path, name: repo.name, action: 'Fetch', result: 'success', message: '远程引用已更新' })
      } catch (error) {
        repo.remoteState = 'error'
        repo.remoteError = error instanceof Error ? error.message.replace(repo.path, repo.name).slice(0, 240) : '远程检查失败'
        await appendHistory({ id: `${Date.now()}-${repo.path}`, at: new Date().toISOString(), repository: repo.path, name: repo.name, action: 'Fetch', result: 'failed', message: repo.remoteError })
      }
    }
  })
  await Promise.all(workers)
  return { settings, repositories: repos, checkedAt: new Date().toISOString() }
}

async function refreshOneRepository(repoPath: string) {
  const settings = await readSettings()
  if (settings.frozen?.includes(repoPath)) throw new Error('此项目已冻结远程检查，请先解除冻结。')
  const repos = await scanRepositories(settings.repositoryRoot, settings.scanDepth)
  for (const repo of repos) if (settings.frozen?.includes(repo.path)) { repo.frozen = true; repo.remoteState = 'frozen' }
  const repo = repos.find(item => item.path === repoPath)
  if (!repo) throw new Error('仓库不在当前扫描目录中，请先重新扫描。')
  try {
    await git(repo.path, ['fetch', '--prune'])
    repo.upstream = await git(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')
    if (!repo.upstream) repo.remoteState = 'no-upstream'
    else {
      const [ahead, behind] = (await git(repo.path, ['rev-list', '--left-right', '--count', `HEAD...${repo.upstream}`])).split(/\s+/).map(Number)
      repo.ahead = ahead || 0; repo.behind = behind || 0
      repo.remoteState = repo.ahead && repo.behind ? 'diverged' : repo.ahead ? 'ahead' : repo.behind ? 'behind' : 'synced'
    }
    await appendHistory({ id: `${Date.now()}-${repo.path}`, at: new Date().toISOString(), repository: repo.path, name: repo.name, action: 'Fetch', result: 'success', message: '远程引用已更新' })
  } catch (error) {
    repo.remoteState = 'error'
    repo.remoteError = error instanceof Error ? error.message.slice(0, 240) : '远程检查失败'
    await appendHistory({ id: `${Date.now()}-${repo.path}`, at: new Date().toISOString(), repository: repo.path, name: repo.name, action: 'Fetch', result: 'failed', message: repo.remoteError })
  }
  return repo
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 640,
    title: 'RepoDesk',
    backgroundColor: '#fafafa',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  })
  ipcMain.removeHandler('window:minimize')
  ipcMain.removeHandler('window:toggle-maximize')
  ipcMain.removeHandler('window:close')
  ipcMain.handle('window:minimize', () => window.minimize())
  ipcMain.handle('window:toggle-maximize', () => window.isMaximized() ? window.unmaximize() : window.maximize())
  ipcMain.handle('window:close', () => window.close())
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:choose-root', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 Git 项目目录', properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const settings = await readSettings()
    settings.repositoryRoot = result.filePaths[0]
    await writeSettings(settings)
    return settings
  })
  ipcMain.handle('settings:set-depth', async (_event, depth: number) => {
    const settings = await readSettings()
    settings.scanDepth = Math.max(1, Math.min(5, Number(depth) || 2))
    await writeSettings(settings)
    return settings
  })
  ipcMain.handle('settings:set-memo-storage', async (_event, mode: 'local' | 'repository') => {
    const settings = await readSettings()
    const nextMode = mode === 'repository' ? 'repository' : 'local'
    if (settings.memoStorage !== nextMode) {
      const repos = await scanRepositories(settings.repositoryRoot, settings.scanDepth)
      if (nextMode === 'repository') {
        for (const repo of repos) {
          const memo = settings.memos?.[repo.path]
          if (memo) await writeRepositoryMemo(repo.path, memo)
        }
      } else {
        settings.memos ??= {}
        for (const repo of repos) {
          const memo = await readRepositoryMemo(repo.path)
          if (memo) settings.memos[repo.path] = memo
          else delete settings.memos[repo.path]
        }
      }
    }
    settings.memoStorage = nextMode
    await writeSettings(settings)
    return settings
  })
  ipcMain.handle('repositories:scan', async () => {
    const settings = await readSettings()
    const repositories = await scanRepositories(settings.repositoryRoot, settings.scanDepth)
    for (const repo of repositories) if (settings.frozen?.includes(repo.path)) { repo.frozen = true; repo.remoteState = 'frozen' }
    return { settings, repositories }
  })
  ipcMain.handle('repositories:refresh', () => refreshRemoteStates())
  ipcMain.handle('repositories:refresh-one', (_event, repoPath: string) => refreshOneRepository(repoPath))
  ipcMain.handle('history:list', async () => {
    try { return JSON.parse(await fs.readFile(historyPath(), 'utf8')) as OperationRecord[] } catch { return [] }
  })
  ipcMain.handle('repositories:open-folder', (_event, repoPath: string) => shell.openPath(repoPath))
  ipcMain.handle('repositories:git-action', async (_event, repoPath: string, action: 'pull' | 'push') => {
    let name = basename(repoPath)
    try {
      const settings = await readSettings()
      if (settings.frozen?.includes(repoPath)) throw new Error('此项目已冻结远程检查，请先解除冻结。')
      await git(repoPath, ['fetch', '--prune'])
      const status = await git(repoPath, ['status', '--porcelain=v1'])
      if (action === 'pull' && status) throw new Error('工作区存在未提交改动。请先处理改动，再执行拉取。')
      const upstream = await git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')
      if (!upstream) throw new Error('当前分支没有配置远程跟踪分支。')
      const counts = await git(repoPath, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
      const [ahead, behind] = counts.split(/\s+/).map(Number)
      if (action === 'pull') {
        if (!behind) throw new Error('远程没有可拉取的提交。')
        if (ahead) throw new Error('本地与远程已分叉；请先手动处理分支。')
        await git(repoPath, ['pull', '--ff-only'])
      } else {
        if (!ahead) throw new Error('本地没有待推送的提交。')
        if (behind) throw new Error('远程包含本地尚未整合的提交；请先拉取并处理分支。')
        await git(repoPath, ['push'])
      }
      await appendHistory({ id: `${Date.now()}-${repoPath}`, at: new Date().toISOString(), repository: repoPath, name, action: action === 'pull' ? 'Pull' : 'Push', result: 'success', message: '操作成功' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(repoPath, name).slice(0, 300) : '操作失败'
      await appendHistory({ id: `${Date.now()}-${repoPath}`, at: new Date().toISOString(), repository: repoPath, name, action: action === 'pull' ? 'Pull' : 'Push', result: 'failed', message })
      throw new Error(message)
    }
  })
  ipcMain.handle('settings:set-memo', async (_event, repoPath: string, memo: string) => {
    const settings = await readSettings()
    const repo = await resolveRepositoryPath(repoPath, settings)
    if (settings.memoStorage === 'repository') await writeRepositoryMemo(repo, memo)
    else {
      settings.memos ??= {}
      if (memo.trim()) settings.memos[repo] = memo
      else delete settings.memos[repo]
      await writeSettings(settings)
    }
    return memo
  })
  ipcMain.handle('settings:get-memo', async (_event, repoPath: string) => {
    const settings = await readSettings()
    const repo = await resolveRepositoryPath(repoPath, settings)
    return settings.memoStorage === 'repository' ? readRepositoryMemo(repo) : settings.memos?.[repo] || ''
  })
  ipcMain.handle('settings:set-favorite', async (_event, repoPath: string, favorite: boolean) => {
    const settings = await readSettings()
    const favorites = new Set(settings.favorites || [])
    favorite ? favorites.add(repoPath) : favorites.delete(repoPath)
    settings.favorites = [...favorites]
    await writeSettings(settings)
    return settings.favorites
  })
  ipcMain.handle('settings:set-frozen', async (_event, repoPath: string, frozen: boolean) => {
    const settings = await readSettings()
    const paths = new Set(settings.frozen || [])
    frozen ? paths.add(repoPath) : paths.delete(repoPath)
    settings.frozen = [...paths]
    await writeSettings(settings)
    return settings.frozen
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
