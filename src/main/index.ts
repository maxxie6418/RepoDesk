import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, basename, relative, isAbsolute, resolve, dirname } from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const settingsPath = () => join(app.getPath('userData'), 'settings.json')
const historyPath = () => join(app.getPath('userData'), 'operations.json')
const documentLibraryPath = () => join(app.getPath('userData'), 'documents.json')
type LibraryDocument = { id: string; name: string; fileName: string; content: string; updatedAt: string }
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
async function readDocuments(): Promise<LibraryDocument[]> {
  try { return JSON.parse(await fs.readFile(documentLibraryPath(), 'utf8')) as LibraryDocument[] } catch { return [] }
}
function ensureInside(root: string, target: string) {
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    if (!rel) return
    throw new Error('目标路径必须位于仓库目录内。')
  }
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
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 })
    return stdout.trimEnd()
  } catch (error) {
    const detail = error as Error & { stderr?: string }
    throw new Error(detail.stderr?.trim() || detail.message)
  }
}
function parsePorcelainStatus(output: string) {
  const entries = output.split('\0').filter(Boolean)
  const files: Array<{ path: string; status: string; staged: boolean; unstaged: boolean }> = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const code = entry.slice(0, 2)
    files.push({ path: entry.slice(3), status: code.trim() || '未跟踪', staged: code[0] !== ' ' && code[0] !== '?', unstaged: code[1] !== ' ' || code[0] === '?' })
    if (code.includes('R') || code.includes('C')) index++
  }
  return files
}
async function getOperationState(repoPath: string) {
  const markers: Array<[string, string]> = [['MERGE_HEAD', '合并中'], ['CHERRY_PICK_HEAD', '拣选提交中'], ['REVERT_HEAD', '撤销提交中']]
  for (const [marker, label] of markers) {
    const markerPath = await git(repoPath, ['rev-parse', '--git-path', marker]).catch(() => '')
    if (markerPath) try { await fs.access(resolve(repoPath, markerPath)); return label } catch { /* marker absent */ }
  }
  for (const marker of ['rebase-merge', 'rebase-apply']) {
    const markerPath = await git(repoPath, ['rev-parse', '--git-path', marker]).catch(() => '')
    if (markerPath) try { await fs.access(resolve(repoPath, markerPath)); return '变基中' } catch { /* marker absent */ }
  }
  return ''
}
async function scanRepositories(root: string, maxDepth: number) {
  const repos: Array<{ name: string; path: string; branch: string; changes: number; staged: number; lastCommit: string; lastCommitAt: string; lastCommitEpoch: number; files: Array<{ path: string; status: string; staged: boolean; unstaged: boolean }>; commits: Array<{ hash: string; subject: string; date: string }>; upstream: string; remoteUrl: string; ahead: number; behind: number; remoteState: string; remoteError: string; remoteCheckedAt: string; operationState: string; frozen: boolean }> = []
  const ignored = new Set(['node_modules', '.npm', '.cache', 'dist', 'build', 'coverage', 'vendor'])
  async function walk(dir: string, depth: number): Promise<void> {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    if (entries.some(entry => entry.name === '.git')) {
      try {
        const [branch, status, lastCommit, lastCommitAt, lastCommitEpoch, log, remoteUrl, operationState] = await Promise.all([
          git(dir, ['branch', '--show-current']).then(value => value || '(detached)'),
          git(dir, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z']),
          git(dir, ['log', '-1', '--pretty=%s']).catch(() => ''),
          git(dir, ['log', '-1', '--pretty=%cr']).catch(() => ''),
          git(dir, ['log', '-1', '--pretty=%ct']).then(Number).catch(() => 0),
          git(dir, ['log', '-5', '--pretty=%h%x1f%s%x1f%cr']).catch(() => ''),
          git(dir, ['remote', 'get-url', 'origin']).catch(() => ''),
          getOperationState(dir)
        ])
        const files = parsePorcelainStatus(status)
        const commits = log.split(/\r?\n/).filter(Boolean).map(line => { const [hash, subject, date] = line.split('\x1f'); return { hash, subject, date } })
        const upstream = await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')
        const counts = upstream ? await git(dir, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).catch(() => '') : ''
        const [aheadRaw, behindRaw] = counts.split(/\s+/)
        const ahead = Number(aheadRaw) || 0
        const behind = Number(behindRaw) || 0
        repos.push({ name: basename(dir), path: dir, branch, changes: files.length, staged: files.filter(file => file.staged).length, lastCommit, lastCommitAt, lastCommitEpoch, files, commits, upstream, remoteUrl, ahead, behind, remoteState: !upstream ? 'no-upstream' : ahead && behind ? 'diverged' : ahead ? 'ahead' : behind ? 'behind' : 'synced', remoteError: '', remoteCheckedAt: '', operationState, frozen: false })
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
        repo.remoteCheckedAt = new Date().toISOString()
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
    repo.remoteCheckedAt = new Date().toISOString()
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
  ipcMain.handle('git:identity', async (_event, repoPath?: string) => {
    const settings = await readSettings()
    const globalName = await git(app.getPath('userData'), ['config', '--global', '--get', 'user.name']).catch(() => '')
    const globalEmail = await git(app.getPath('userData'), ['config', '--global', '--get', 'user.email']).catch(() => '')
    if (!repoPath) return { globalName, globalEmail, name: globalName, email: globalEmail, source: 'global' as const }
    const repo = await resolveRepositoryPath(repoPath, settings)
    const localName = await git(repo, ['config', '--local', '--get', 'user.name']).catch(() => '')
    const localEmail = await git(repo, ['config', '--local', '--get', 'user.email']).catch(() => '')
    const name = await git(repo, ['config', '--get', 'user.name']).catch(() => '')
    const email = await git(repo, ['config', '--get', 'user.email']).catch(() => '')
    return { globalName, globalEmail, name, email, source: localName || localEmail ? 'repository' as const : 'global' as const }
  })
  ipcMain.handle('documents:list', () => readDocuments())
  ipcMain.handle('documents:save', async (_event, document: LibraryDocument) => {
    if (!document?.id || !document.name?.trim() || !document.fileName?.trim() || typeof document.content !== 'string') throw new Error('文档名称、文件名或内容格式无效。')
    if (document.content.length > 1024 * 1024) throw new Error('文档不能超过 1 MB。')
    const documents = await readDocuments()
    const saved = { ...document, name: document.name.trim(), fileName: basename(document.fileName.trim()), updatedAt: new Date().toISOString() }
    const index = documents.findIndex(item => item.id === saved.id)
    if (index < 0) documents.unshift(saved)
    else documents[index] = saved
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(documentLibraryPath(), JSON.stringify(documents, null, 2), 'utf8')
    return documents
  })
  ipcMain.handle('documents:delete', async (_event, id: string) => {
    const documents = (await readDocuments()).filter(document => document.id !== id)
    await fs.writeFile(documentLibraryPath(), JSON.stringify(documents, null, 2), 'utf8')
    return documents
  })
  ipcMain.handle('documents:publish', async (_event, id: string, repoPaths: string[], destination: string, overwrite: boolean) => {
    const document = (await readDocuments()).find(item => item.id === id)
    if (!document) throw new Error('文档不存在，请刷新文档库。')
    if (!destination?.trim() || isAbsolute(destination) || /^[A-Za-z]:/.test(destination) || destination.split(/[\\/]/).some(part => part === '..' || part === '.' || part.toLowerCase() === '.git')) throw new Error('请输入仓库内的相对发布文件路径。')
    if (!repoPaths?.length) throw new Error('请至少选择一个目标项目。')
    const settings = await readSettings()
    const targets = await Promise.all([...new Set(repoPaths)].map(async repoPath => {
      const repo = await resolveRepositoryPath(repoPath, settings)
      const target = resolve(repo, destination)
      ensureInside(repo, target)
      let parent = dirname(target)
      while (true) {
        try { parent = await fs.realpath(parent); break }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          const next = dirname(parent)
          if (next === parent) throw error
          parent = next
        }
      }
      const realParent = parent
      ensureInside(repo, realParent)
      let current: string | null = null
      try {
        const realTarget = await fs.realpath(target)
        ensureInside(repo, realTarget)
        current = await fs.readFile(realTarget, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return { repo, target, current }
    }))
    const conflicts = targets.filter(target => target.current !== null && target.current !== document.content).map(target => basename(target.repo))
    if (conflicts.length && !overwrite) return { published: [], unchanged: targets.filter(target => target.current === document.content).map(target => basename(target.repo)), conflicts }
    const published: string[] = []
    const unchanged: string[] = []
    for (const target of targets) {
      const name = basename(target.repo)
      if (target.current === document.content) { unchanged.push(name); continue }
      await fs.mkdir(dirname(target.target), { recursive: true })
      const realParent = await fs.realpath(dirname(target.target))
      ensureInside(target.repo, realParent)
      await fs.writeFile(target.target, document.content, 'utf8')
      published.push(name)
      await appendHistory({ id: `${Date.now()}-${target.repo}`, at: new Date().toISOString(), repository: target.repo, name, action: 'Publish document', result: 'success', message: `${document.fileName} → ${destination}` })
    }
    return { published, unchanged, conflicts: [] as string[] }
  })
  ipcMain.handle('repositories:open-folder', async (_event, repoPath: string) => {
    const repo = await resolveRepositoryPath(repoPath, await readSettings())
    return shell.openPath(repo)
  })
  ipcMain.handle('repositories:open-remote', async (_event, repoPath: string) => {
    const settings = await readSettings()
    const repo = await resolveRepositoryPath(repoPath, settings)
    const remote = await git(repo, ['remote', 'get-url', 'origin']).catch(() => '')
    let url = ''
    if (/^https?:\/\//i.test(remote)) url = remote
    else if (/^ssh:\/\//i.test(remote)) {
      const parsed = new URL(remote)
      url = `https://${parsed.host}${parsed.pathname}`
    } else {
      const scp = remote.match(/^(?:[^@]+@)?([^:]+):(.+)$/)
      if (scp) url = `https://${scp[1]}/${scp[2]}`
    }
    if (!url) throw new Error('此仓库没有可打开的远程 origin 地址。')
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('远程地址格式不受支持。')
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    await shell.openExternal(parsed.toString())
    return true
  })
  ipcMain.handle('repositories:stage', async (_event, repoPath: string, files: string[]) => {
    const settings = await readSettings()
    const repo = await resolveRepositoryPath(repoPath, settings)
    const safeFiles = files.filter(file => typeof file === 'string' && file && !file.startsWith('-') && !isAbsolute(file) && !file.split(/[\\/]/).includes('..'))
    if (!safeFiles.length) throw new Error('请选择要暂存的文件。')
    await git(repo, ['add', '--', ...safeFiles])
    return git(repo, ['status', '--porcelain=v1'])
  })
  ipcMain.handle('repositories:unstage', async (_event, repoPath: string, files: string[]) => {
    const settings = await readSettings()
    const repo = await resolveRepositoryPath(repoPath, settings)
    const safeFiles = files.filter(file => typeof file === 'string' && file && !file.startsWith('-') && !isAbsolute(file) && !file.split(/[\\/]/).includes('..'))
    if (!safeFiles.length) throw new Error('请选择要取消暂存的文件。')
    await git(repo, ['restore', '--staged', '--', ...safeFiles])
    return git(repo, ['status', '--porcelain=v1'])
  })
  ipcMain.handle('repositories:diff', async (_event, repoPath: string, file: string, staged: boolean) => {
    const settings = await readSettings()
    const repo = await resolveRepositoryPath(repoPath, settings)
    if (!file || file.startsWith('-') || isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new Error('文件路径无效。')
    return git(repo, ['diff', '--no-ext-diff', '--no-color', ...(staged ? ['--cached'] : []), '--', file])
  })
  ipcMain.handle('repositories:commit', async (_event, repoPath: string, message: string) => {
    const settings = await readSettings()
    const repo = await resolveRepositoryPath(repoPath, settings)
    const name = basename(repo)
    try {
      if (!message.trim()) throw new Error('请填写提交说明。')
      const staged = await git(repo, ['diff', '--cached', '--name-only'])
      if (!staged) throw new Error('暂存区为空，请先暂存要提交的文件。')
      await git(repo, ['-c', 'core.quotepath=false', 'commit', '-m', message.trim()])
      await appendHistory({ id: `${Date.now()}-${repo}`, at: new Date().toISOString(), repository: repo, name, action: 'Commit', result: 'success', message: message.trim().slice(0, 180) })
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(repo, name).slice(0, 300) : '提交失败'
      await appendHistory({ id: `${Date.now()}-${repo}`, at: new Date().toISOString(), repository: repo, name, action: 'Commit', result: 'failed', message: detail })
      throw new Error(detail)
    }
  })
  ipcMain.handle('repositories:git-action', async (_event, repoPath: string, action: 'pull' | 'push') => {
    let name = basename(typeof repoPath === 'string' ? repoPath : '')
    try {
      const settings = await readSettings()
      if (action !== 'pull' && action !== 'push') throw new Error('Git 操作类型无效。')
      const repo = await resolveRepositoryPath(repoPath, settings)
      name = basename(repo)
      if (settings.frozen?.includes(repo)) throw new Error('此项目已冻结远程检查，请先解除冻结。')
      await git(repo, ['fetch', '--prune'])
      const status = await git(repo, ['status', '--porcelain=v1', '-z'])
      if (action === 'pull' && status) throw new Error('工作区存在未提交改动。请先处理改动，再执行拉取。')
      const upstream = await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')
      if (!upstream) throw new Error('当前分支没有配置远程跟踪分支。')
      const counts = await git(repo, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
      const [ahead, behind] = counts.split(/\s+/).map(Number)
      if (action === 'pull') {
        if (!behind) throw new Error('远程没有可拉取的提交。')
        if (ahead) throw new Error('本地与远程已分叉；请先手动处理分支。')
        await git(repo, ['pull', '--ff-only'])
      } else {
        if (!ahead) throw new Error('本地没有待推送的提交。')
        if (behind) throw new Error('远程包含本地尚未整合的提交；请先拉取并处理分支。')
        await git(repo, ['push'])
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
