import { useCallback, useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronDown, CircleHelp, Clock3, FolderGit2, GitBranch, LayoutDashboard, ListChecks, Minus, RefreshCw, Settings2, ShieldAlert, Square, X, FileCode2, GitCommitHorizontal, ArrowDownToLine, ArrowUpFromLine, ExternalLink, Star, StickyNote, PauseCircle, PlayCircle, Globe2, Library, Plus, Save, Trash2, Send, Upload, Info } from 'lucide-react'

type Page = 'overview' | 'projects' | 'operations' | 'documents' | 'history' | 'settings'
type Repo = RepoDeskRepository
type Settings = RepoDeskSettings
type HistoryRow = { id: string; at: string; repository: string; name: string; action: string; result: 'success' | 'failed'; message: string }
const pages: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard }, { id: 'projects', label: '全部项目', icon: FolderGit2 },
  { id: 'operations', label: '项目操作', icon: GitBranch }, { id: 'documents', label: '文档库', icon: Library }, { id: 'history', label: '操作记录', icon: Clock3 }, { id: 'settings', label: '设置', icon: Settings2 }
]
const labels: Record<Page, string> = { overview: '总览', projects: '全部项目', operations: '项目操作', documents: '文档库', history: '操作记录', settings: '设置' }

function App() {
  const [page, setPage] = useState<Page>('overview')
  const [repos, setRepos] = useState<Repo[]>([])
  const [settings, setSettings] = useState<Settings>({ repositoryRoot: '', scanDepth: 2 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [memoRepo, setMemoRepo] = useState<Repo | null>(null)
  const [memoDraft, setMemoDraft] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [diffText, setDiffText] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [batchAction, setBatchAction] = useState<'pull' | 'push' | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [gitIdentity, setGitIdentity] = useState<{ globalName: string; globalEmail: string; name: string; email: string; source: 'global' | 'repository' } | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState('')
  const scan = useCallback(async () => {
    setBusy(true); setError('')
    try { const result = await window.repoDesk.repositories.refresh(); setSettings(result.settings); setRepos(result.repositories); setLastCheckedAt(result.checkedAt); setSelectedPaths(current => current.filter(path => result.repositories.some(repo => repo.path === path))); setSelectedRepo(current => current ? result.repositories.find(repo => repo.path === current.path) || null : null) }
    catch (e) { setError(e instanceof Error ? e.message : '扫描失败') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { scan() }, [scan])
  useEffect(() => { if (page === 'history') window.repoDesk.history.list().then(setHistory).catch(() => setHistory([])) }, [page, actionMessage])
  useEffect(() => { if (page === 'settings') window.repoDesk.git.identity().then(setGitIdentity).catch(() => setGitIdentity(null)) }, [page])
  const chooseRoot = async () => { const next = await window.repoDesk.settings.chooseRoot(); if (next) { setSettings(next); await scan() } }
  const setDepth = async (depth: number) => { const next = await window.repoDesk.settings.setDepth(depth); setSettings(next); await scan() }
  const activeLabel = labels[page]
  const modifiedCount = repos.filter(repo => repo.changes > 0).length
  const sortedRepos = [...repos].sort((a, b) => b.lastCommitEpoch - a.lastCommitEpoch)
  const favorites = sortedRepos.filter(repo => settings.favorites?.includes(repo.path))
  const toggleSelection = (repoPath: string) => setSelectedPaths(current => current.includes(repoPath) ? current.filter(path => path !== repoPath) : [...current, repoPath])
  const selectedRepos = repos.filter(repo => selectedPaths.includes(repo.path))
  const selectableRepos = sortedRepos.filter(repo => `${repo.name} ${repo.path}`.toLowerCase().includes(query.toLowerCase()))
  const openMemo = async (repo: Repo) => { setMemoRepo(repo); setMemoDraft(''); try { setMemoDraft(await window.repoDesk.settings.getMemo(repo.path)) } catch (e) { setActionMessage(e instanceof Error ? e.message : '读取备忘失败') } }
  const toggleFavorite = async (repo: Repo) => { const favorites = await window.repoDesk.settings.setFavorite(repo.path, !settings.favorites?.includes(repo.path)); setSettings(prev => ({ ...prev, favorites })) }
  const toggleFrozen = async (repo: Repo) => { const frozen = await window.repoDesk.settings.setFrozen(repo.path, !repo.frozen); setSettings(prev => ({ ...prev, frozen })); setRepos(prev => prev.map(item => item.path === repo.path ? { ...item, frozen: !repo.frozen, remoteState: !repo.frozen ? 'frozen' : 'unknown', ahead: !repo.frozen ? item.ahead : 0, behind: !repo.frozen ? item.behind : 0 } : item)) }
  const runRepoAction = async (repo: Repo, action: 'pull' | 'push' | 'refresh') => {
    if (action === 'refresh') {
      try { const fresh = await window.repoDesk.repositories.refreshOne(repo.path); setRepos(prev => prev.map(item => item.path === repo.path ? fresh : item)); setLastCheckedAt(fresh.remoteCheckedAt || new Date().toISOString()) }
      catch (e) { setActionMessage(e instanceof Error ? e.message : '远程检查失败') }
      return
    }
    setActionMessage('')
    try { await window.repoDesk.repositories.action(repo.path, action); setActionMessage(`${repo.name} ${action === 'pull' ? '拉取' : '推送'}成功`); await scan() }
    catch (e) { setActionMessage(e instanceof Error ? e.message : '操作失败') }
  }
  const runBatch = async (action: 'pull' | 'push') => {
    const chosen = repos.filter(repo => selectedPaths.includes(repo.path))
    const eligible = chosen.filter(repo => !getBatchSkipReason(repo, action))
    let succeeded = 0
    const failures: string[] = []
    for (const repo of eligible) {
      try { await window.repoDesk.repositories.action(repo.path, action); succeeded++ }
      catch (e) { failures.push(`${repo.name}: ${e instanceof Error ? e.message : '失败'}`) }
    }
    const skipped = chosen.length - eligible.length
    const skippedNames = chosen.filter(repo => getBatchSkipReason(repo, action)).map(repo => `${repo.name}（${getBatchSkipReason(repo, action)}）`)
    setActionMessage(`批量${action === 'pull' ? '拉取' : '推送'}：${succeeded} 成功，${skipped} 跳过，${failures.length} 失败${skippedNames.length ? `；跳过：${skippedNames.join('、')}` : ''}${failures.length ? `；失败：${failures.join('；')}` : ''}`)
    setSelectedPaths([])
    setBatchAction(null)
    await scan()
  }
  const stageFiles = async (files: string[], staged: boolean) => {
    if (!selectedRepo) return
    try { await (staged ? window.repoDesk.repositories.unstage(selectedRepo.path, files) : window.repoDesk.repositories.stage(selectedRepo.path, files)); await scan() }
    catch (e) { setActionMessage(e instanceof Error ? e.message : '更新暂存区失败') }
  }
  const showDiff = async (file: string, staged: boolean) => {
    if (!selectedRepo) return
    try { setDiffText(await window.repoDesk.repositories.diff(selectedRepo.path, file, staged)) }
    catch (e) { setDiffText(e instanceof Error ? e.message : '读取差异失败') }
  }
  const openRemote = async (repo: Repo) => { try { await window.repoDesk.repositories.openRemote(repo.path) } catch (e) { setActionMessage(e instanceof Error ? e.message : '打开远程仓库失败') } }
  const commitChanges = async () => {
    if (!selectedRepo) return
    try { await window.repoDesk.repositories.commit(selectedRepo.path, commitMessage); setCommitMessage(''); setActionMessage(`${selectedRepo.name} 提交成功`); await scan() }
    catch (e) { setActionMessage(e instanceof Error ? e.message : '提交失败') }
  }

  return <Tooltip.Provider delayDuration={350}><div className="app-shell">
    <aside className="sidebar"><div className="brand"><img src="./repodesk.svg" alt=""/><span>RepoDesk</span></div><div className="nav-label">工作空间</div>
      <nav>{pages.slice(0, 3).map(item => <NavItem key={item.id} {...item} active={page === item.id} onClick={() => setPage(item.id)} />)}</nav><div className="nav-label nav-label-spaced">管理</div>
      <nav>{pages.slice(3).map(item => <NavItem key={item.id} {...item} active={page === item.id} onClick={() => setPage(item.id)} />)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" />Git 环境已连接<span className="version">v0.2.0 · 开发预览</span></div>
    </aside>
    <section className="main-area"><header className="topbar"><div className="breadcrumbs">工作空间 <span>/</span> <strong>{activeLabel}</strong></div><div className="top-actions"><button className="icon-button" aria-label="帮助" onClick={() => setHelpOpen(true)}><CircleHelp size={16}/></button><div className="top-divider"/><button className="profile" onClick={() => setPage('settings')} title="查看 Git 提交身份"><span className="avatar">M</span><span>本地 Git 身份</span><ChevronDown size={14}/></button><div className="window-controls"><button aria-label="最小化" onClick={() => window.repoDesk.window.minimize()}><Minus size={15}/></button><button aria-label="最大化或还原" onClick={() => window.repoDesk.window.toggleMaximize()}><Square size={12}/></button><button className="close" aria-label="关闭" onClick={() => window.repoDesk.window.close()}><X size={16}/></button></div></div></header>
      <main className="page-content"><div className="page-heading"><div><div className="eyebrow">WORKSPACE</div><h1>{activeLabel}</h1>{page === 'overview' && lastCheckedAt && <p>远程状态检查于 {new Date(lastCheckedAt).toLocaleString()}</p>}</div>{page !== 'settings' && page !== 'documents' && <div className="heading-actions">{page === 'projects' && <><button className="button" onClick={() => setSelectedPaths(selectableRepos.every(repo => selectedPaths.includes(repo.path)) ? selectedPaths.filter(path => !selectableRepos.some(repo => repo.path === path)) : [...new Set([...selectedPaths, ...selectableRepos.map(repo => repo.path)])])} disabled={!selectableRepos.length}>{selectableRepos.length && selectableRepos.every(repo => selectedPaths.includes(repo.path)) ? '取消全选' : '全选当前结果'}</button><button className="button" onClick={() => setBatchAction('pull')} disabled={busy || !selectedPaths.length}>拉取所选 ({selectedPaths.length})</button><button className="button" onClick={() => setBatchAction('push')} disabled={busy || !selectedPaths.length}>推送所选</button></>}{page === 'operations' && selectedRepo && <button className="button" onClick={() => setSelectedRepo(null)}>选择项目</button>}<button className="button button-primary" onClick={scan} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''}/> {busy ? '扫描中…' : '刷新仓库'}</button></div>}</div>
        {error && <div className="error-banner">{error}</div>}
        {actionMessage && <div className="action-message" role="status" aria-live="polite"><span>{actionMessage}</span><button aria-label="关闭提示" onClick={() => setActionMessage('')}>×</button></div>}
        {page === 'history' ? <section className="settings-panel"><div className="settings-head"><div><h2>操作历史</h2><p>记录保存在此设备，最多保留最近 500 条。</p></div></div>{history.length ? history.map(item => <div className="history-row" key={item.id}><span className={`history-mark ${item.result}`}>{item.result === 'success' ? '✓' : '!'}</span><div className="history-main"><strong>{item.action} · {item.name}</strong><span>{item.message}</span></div><time>{new Date(item.at).toLocaleString()}</time></div>) : <div className="detail-empty">还没有操作记录。刷新仓库或执行拉取、推送后会显示在这里。</div>}</section> : page === 'documents' ? <DocumentLibrary repos={repos}/> : page === 'settings' ? <section className="settings-panel"><div className="settings-head"><div><h2>仓库扫描</h2><p>选择包含 Git 项目的文件夹，并设置向下扫描的层数。</p></div><FolderGit2 size={18}/></div><div className="setting-row"><div><strong>项目根目录</strong><span>{settings.repositoryRoot || '尚未选择目录'}</span></div><button className="button" onClick={chooseRoot}>选择文件夹</button></div><div className="setting-row"><div><strong>最大扫描深度</strong><span>根目录下递归查找仓库；默认最多两层</span></div><select value={settings.scanDepth} onChange={e => setDepth(Number(e.target.value))}><option value={1}>1 层</option><option value={2}>2 层（默认）</option><option value={3}>3 层</option><option value={4}>4 层</option><option value={5}>5 层</option></select></div><div className="setting-row"><div><strong>项目备忘保存位置</strong><span>{settings.memoStorage === 'repository' ? '写入每个仓库根目录的 list.md' : '保存在本机，不写入项目文件'}</span></div><select value={settings.memoStorage || 'local'} onChange={async e => setSettings(await window.repoDesk.settings.setMemoStorage(e.target.value as 'local' | 'repository'))}><option value="local">本机</option><option value="repository">项目根目录 list.md</option></select></div><div className="settings-foot">仓库扫描会跳过 node_modules、dist、build、coverage 等常见依赖和构建目录。</div><div className="git-identity-block"><div className="settings-head"><div><h2>Git 提交身份</h2><p>提交署名与远程认证相互独立，沿用本机 Git 配置。</p></div><Info size={17}/></div>{gitIdentity ? <><div className="identity-row"><span>有效身份</span><strong>{gitIdentity.name || '未配置'} &lt;{gitIdentity.email || '未配置'}&gt;</strong><small>来源：{gitIdentity.source === 'repository' ? '仓库级覆盖' : '全局配置'}</small></div><div className="identity-row"><span>全局默认</span><strong>{gitIdentity.globalName || '未配置'} &lt;{gitIdentity.globalEmail || '未配置'}&gt;</strong></div></> : <div className="detail-empty">无法读取 Git 身份配置。</div>}</div></section> : page === 'projects' ? <section className="settings-panel"><div className="list-toolbar"><input placeholder="搜索项目名称或路径" value={query} onChange={e => setQuery(e.target.value)}/><span>{repos.length} 个仓库</span></div><RepoList repos={selectableRepos} favorites={settings.favorites || []} onSelect={repo => { setSelectedRepo(repo); setPage('operations') }} onMemo={openMemo} onFavorite={toggleFavorite} onFreeze={toggleFrozen} onAction={runRepoAction} selectable selectedPaths={selectedPaths} onToggleSelection={toggleSelection}/></section> : page === 'overview' ? <><div className="stats-grid"><Metric label="全部项目" value={repos.length} hint={settings.repositoryRoot || '请先在设置中选择目录'} icon={<FolderGit2 size={16}/>}/><Metric label="有本地改动" value={modifiedCount} hint="包含已暂存和未提交改动" icon={<GitBranch size={16}/>}/><Metric label="待推送" value={repos.filter(repo => repo.ahead > 0).length} hint="本地存在尚未推送的提交" icon={<ListChecks size={16}/>}/></div><div className="settings-panel"><div className="settings-head"><div><h2>最近更新</h2><p>按最近提交时间排序</p></div><button className="text-button" onClick={() => setPage('projects')}>全部项目 →</button></div><RepoList repos={sortedRepos.slice(0, 5)} favorites={settings.favorites || []} onSelect={repo => { setSelectedRepo(repo); setPage('operations') }} onMemo={openMemo} onFavorite={toggleFavorite} onFreeze={toggleFrozen} onAction={runRepoAction} compact/>{!repos.length && <EmptyState onChoose={chooseRoot}/>}</div><div className="settings-panel favorites-panel"><div className="settings-head"><div><h2><Star size={15}/> 收藏项目</h2><p>常用仓库会固定显示在这里</p></div></div>{favorites.length ? <RepoList repos={favorites} favorites={settings.favorites || []} onSelect={repo => { setSelectedRepo(repo); setPage('operations') }} onMemo={openMemo} onFavorite={toggleFavorite} onFreeze={toggleFrozen} onAction={runRepoAction} compact/> : <div className="favorite-empty"></div>}</div></> : page === 'operations' ? selectedRepo ? <RepositoryDetail repo={selectedRepo} onRefresh={scan} onStage={stageFiles} onDiff={showDiff} diffText={diffText} onCommit={commitChanges} commitMessage={commitMessage} setCommitMessage={setCommitMessage} onPush={() => runRepoAction(selectedRepo, 'push')} onPull={() => runRepoAction(selectedRepo, 'pull')} onOpenRemote={() => openRemote(selectedRepo)} onOpenFolder={() => window.repoDesk.repositories.openFolder(selectedRepo.path)} onMemo={() => openMemo(selectedRepo)} onFavorite={() => toggleFavorite(selectedRepo)} onFreeze={() => toggleFrozen(selectedRepo)} favorite={Boolean(settings.favorites?.includes(selectedRepo.path))} frozen={selectedRepo.frozen}/> : <ProjectChooser repos={sortedRepos} onSelect={repo => setSelectedRepo(repo)}/> : <section className="placeholder-card"><div className="placeholder-icon">{page === 'operations' ? <GitBranch size={22}/> : <Clock3 size={22}/>}</div><h2>{activeLabel}将在后续阶段接入</h2><p>{page === 'operations' ? '从项目列表选择仓库以查看详情。' : '操作记录将在 Git 操作接入后显示。'}</p></section>}

      </main></section>
    {memoRepo && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setMemoRepo(null) }}><section className="memo-dialog" role="dialog" aria-modal="true" aria-labelledby="memo-title"><div className="memo-head"><div><h2 id="memo-title">项目备忘</h2><p>{memoRepo.name}</p></div><button className="icon-button" onClick={() => setMemoRepo(null)} aria-label="关闭"><X size={16}/></button></div><textarea autoFocus maxLength={3000} placeholder="记录这个项目的待办、背景或常用命令…" value={memoDraft} onChange={e => setMemoDraft(e.target.value)}/><div className="memo-foot"><span>{memoDraft.length}/3000 · {settings.memoStorage === 'repository' ? '保存到项目根目录 list.md' : '保存到本机'}</span><button className="button button-primary" onClick={async () => { await window.repoDesk.settings.setMemo(memoRepo.path, memoDraft); setSettings(prev => ({ ...prev, memos: { ...prev.memos, [memoRepo.path]: memoDraft } })); setMemoRepo(null) }}>保存备忘</button></div></section></div>}
    {batchAction && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setBatchAction(null) }}><section className="memo-dialog batch-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-title"><div className="memo-head"><div><h2 id="batch-title">确认批量{batchAction === 'pull' ? '拉取' : '推送'}</h2><p>仅对可安全执行的所选仓库运行 Git 操作。</p></div><button className="icon-button" onClick={() => setBatchAction(null)} aria-label="关闭"><X size={16}/></button></div><div className="batch-preview">{selectedRepos.map(repo => { const reason = getBatchSkipReason(repo, batchAction); return <div className="batch-preview-row" key={repo.path}><span className={reason ? 'batch-skip' : 'batch-ready'}>{reason ? '跳过' : '将执行'}</span><strong>{repo.name}</strong><small>{reason || (batchAction === 'pull' ? `快进拉取 ${repo.behind} 个提交` : `推送 ${repo.ahead} 个提交`)}</small></div> })}</div><div className="memo-foot"><span>{selectedRepos.filter(repo => !getBatchSkipReason(repo, batchAction)).length} 个可执行 · {selectedRepos.filter(repo => getBatchSkipReason(repo, batchAction)).length} 个跳过</span><div><button className="button" onClick={() => setBatchAction(null)}>取消</button><button className="button button-primary" disabled={busy || !selectedRepos.some(repo => !getBatchSkipReason(repo, batchAction))} onClick={() => runBatch(batchAction)}>开始执行</button></div></div></section></div>}
    {helpOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setHelpOpen(false) }}><section className="memo-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="memo-head"><div><h2 id="help-title">RepoDesk 使用说明</h2><p>在一个窗口查看和管理多个本地 Git 仓库。</p></div><button className="icon-button" onClick={() => setHelpOpen(false)} aria-label="关闭"><X size={16}/></button></div><ul><li>先在“设置”中选择包含项目的根目录。</li><li>“全部项目”支持搜索、勾选仓库，并预览批量拉取或推送结果。</li><li>仓库详情可查看差异、暂存文件、提交和检查远程状态。</li><li>远程认证沿用本机 Git 凭据；提交身份可在设置中查看。</li></ul><div className="memo-foot"><span>推拉前会重新检查分支关系和工作区状态。</span><button className="button button-primary" onClick={() => setHelpOpen(false)}>知道了</button></div></section></div>}
  </div></Tooltip.Provider>
}
function Metric({ label, value, hint, icon }: { label: string; value: number | string; hint: string; icon: React.ReactNode }) { return <div className="metric"><div className="metric-head">{label}<span className="metric-icon">{icon}</span></div><strong>{value}</strong><small title={hint}>{hint}</small></div> }
function getBatchSkipReason(repo: Repo, action: 'pull' | 'push') {
  if (repo.frozen) return '远程检查已冻结'
  if (repo.remoteState === 'unknown') return '远程状态尚未检查'
  if (repo.remoteState === 'error') return '远程检查失败'
  if (!repo.upstream) return '未配置跟踪分支'
  if (action === 'pull') {
    if (!repo.behind) return '没有待拉取提交'
    if (repo.changes) return '工作区有未提交修改'
    if (repo.ahead) return '本地与远程已分叉'
    return ''
  }
  if (!repo.ahead) return '没有待推送提交'
  if (repo.behind) return '远程有尚未整合的提交'
  return ''
}
function formatFreshness(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  if (!Number.isFinite(elapsed)) return '检查时间未知'
  if (elapsed < 60_000) return '刚刚检查'
  if (elapsed < 3_600_000) return `${elapsed > 30 * 60_000 ? '状态可能过期 · ' : ''}${Math.floor(elapsed / 60_000)} 分钟前检查`
  const hours = Math.floor(elapsed / 3_600_000)
  return elapsed > 30 * 60_000 ? `状态可能过期 · ${hours} 小时前检查` : `${hours} 小时前检查`
}
function ProjectChooser({ repos, onSelect }: { repos: Repo[]; onSelect: (repo: Repo) => void }) {
  const [query, setQuery] = useState('')
  const filtered = repos.filter(repo => `${repo.name} ${repo.path} ${repo.branch}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="settings-panel operation-projects"><div className="list-toolbar"><input placeholder="搜索项目名称、路径或分支" value={query} onChange={event => setQuery(event.target.value)}/><span>{filtered.length} 个项目</span></div>{filtered.length ? filtered.map(repo => <button className="operation-project" key={repo.path} onClick={() => onSelect(repo)}><span className="operation-project-icon"><FolderGit2 size={16}/></span><span className="operation-project-main"><strong>{repo.name}</strong><small>{repo.path}</small></span><span className="repo-branch"><GitBranch size={13}/>{repo.branch}</span><span className={`state-pill ${repo.changes ? 'dirty' : ''}`}>{repo.changes ? `${repo.changes} 处改动` : '工作区干净'}</span><span className="operation-project-remote">{remoteSummary(repo)}</span><span className="button">打开</span></button>) : <div className="detail-empty">没有匹配的项目。</div>}</section>
}
function DocumentLibrary({ repos }: { repos: Repo[] }) {
  const [documents, setDocuments] = useState<RepoDeskLibraryDocument[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<RepoDeskLibraryDocument | null>(null)
  const [targets, setTargets] = useState<string[]>([])
  const [destination, setDestination] = useState('AGENTS.md')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { window.repoDesk.documents.list().then(items => { setDocuments(items); if (items[0]) { setSelectedId(items[0].id); setDraft(items[0]); setDestination(items[0].fileName) } }).catch(error => setMessage(error instanceof Error ? error.message : '读取文档库失败')) }, [])
  const chooseDocument = (document: RepoDeskLibraryDocument) => { setSelectedId(document.id); setDraft(document); setDestination(document.fileName); setMessage('') }
  const createDocument = () => { const document = { id: crypto.randomUUID(), name: '通用协作规范', fileName: 'AGENTS.md', content: '# 通用协作规范\n\n', updatedAt: new Date().toISOString() }; setSelectedId(document.id); setDraft(document); setDestination(document.fileName); setMessage('') }
  const saveDocument = async () => {
    if (!draft) return null
    setBusy(true)
    try { const updated = await window.repoDesk.documents.save(draft); setDocuments(updated); setDraft(updated.find(item => item.id === draft.id) || draft); setMessage('文档已保存到本机文档库'); return updated.find(item => item.id === draft.id) || draft }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); return null }
    finally { setBusy(false) }
  }
  const publish = async () => {
    if (!draft || !targets.length) { setMessage('请选择至少一个目标项目。'); return }
    if (!destination.trim()) { setMessage('请填写仓库内的发布路径。'); return }
    const saved = await saveDocument()
    if (!saved) return
    setBusy(true)
    try {
      let result = await window.repoDesk.documents.publish(saved.id, targets, destination, false)
      if (result.conflicts.length) {
        const confirmed = window.confirm(`以下项目已存在内容不同的 ${destination}：\n${result.conflicts.join('\n')}\n\n要覆盖这些文件吗？`)
        if (!confirmed) { setMessage('发布已取消；已有文件未被覆盖。'); return }
        result = await window.repoDesk.documents.publish(saved.id, targets, destination, true)
      }
      setMessage(`发布完成：${result.published.length} 个项目已更新，${result.unchanged.length} 个内容相同。`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '发布失败') }
    finally { setBusy(false) }
  }
  const deleteDocument = async () => {
    if (!draft || !documents.some(item => item.id === draft.id)) return
    if (!window.confirm(`从本机文档库删除“${draft.name}”？已发布到项目的文件不会删除。`)) return
    const updated = await window.repoDesk.documents.delete(draft.id)
    setDocuments(updated); setDraft(updated[0] || null); setSelectedId(updated[0]?.id || ''); setDestination(updated[0]?.fileName || 'AGENTS.md'); setMessage('文档已从本机文档库删除')
  }
  return <div className="document-library"><aside className="settings-panel document-list"><div className="settings-head"><div><h2>本机文档</h2></div><div className="document-list-actions"><label className="button"><Upload size={13}/> 导入<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; const imported = { id: crypto.randomUUID(), name: file.name.replace(/\.(md|markdown|txt)$/i, ''), fileName: file.name, content: await file.text(), updatedAt: new Date().toISOString() }; setDraft(imported); setSelectedId(imported.id); setDestination(imported.fileName); setMessage('已导入，请保存到本机文档库。'); event.target.value = '' }}/></label><button className="button" onClick={createDocument}><Plus size={14}/> 新建</button></div></div>{documents.map(document => <button className={`document-item ${selectedId === document.id ? 'active' : ''}`} key={document.id} onClick={() => chooseDocument(document)}><strong>{document.name}</strong><span>{document.fileName}</span></button>)}{!documents.length && <div className="detail-empty">还没有保存的通用文档。</div>}</aside><section className="settings-panel document-editor"><div className="document-editor-head"><h2>{draft ? '编辑文档' : '选择或新建文档'}</h2><div>{draft && documents.some(item => item.id === draft.id) && <button className="button" onClick={deleteDocument}><Trash2 size={13}/> 删除</button>}<button className="button button-primary" disabled={!draft || busy} onClick={saveDocument}><Save size={13}/> 保存</button></div></div>{draft && <><div className="document-fields"><input value={draft.name} placeholder="文档名称" onChange={event => setDraft({ ...draft, name: event.target.value })}/><input value={draft.fileName} placeholder="默认发布文件名，例如 AGENTS.md" onChange={event => { setDraft({ ...draft, fileName: event.target.value }); if (destination === draft.fileName) setDestination(event.target.value) }}/></div><textarea className="document-content" value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} spellCheck={false}/><div className="publish-panel"><h3><Send size={14}/> 发布到项目</h3><input value={destination} onChange={event => setDestination(event.target.value)} placeholder="仓库内相对路径，例如 AGENTS.md 或 docs/AGENTS.md"/><div className="publish-targets">{repos.map(repo => <label key={repo.path}><input type="checkbox" checked={targets.includes(repo.path)} onChange={event => setTargets(current => event.target.checked ? [...current, repo.path] : current.filter(path => path !== repo.path))}/><span>{repo.name}</span></label>)}</div><button className="button button-primary" disabled={busy || !targets.length} onClick={publish}><Send size={13}/> 发布到 {targets.length || '…'} 个项目</button></div></>}{message && <div className="action-message-inline" role="status">{message}</div>}</section></div>
}
function RepoList({ repos, favorites, onSelect, onMemo, onFavorite, onFreeze, onAction, compact = false, selectable = false, selectedPaths = [], onToggleSelection }: { repos: Repo[]; favorites: string[]; onSelect: (repo: Repo) => void; onMemo: (repo: Repo) => void; onFavorite: (repo: Repo) => void; onFreeze: (repo: Repo) => void; onAction: (repo: Repo, action: 'pull' | 'push' | 'refresh') => void; compact?: boolean; selectable?: boolean; selectedPaths?: string[]; onToggleSelection?: (path: string) => void }) {
  const openRemote = async (repo: Repo) => { try { await window.repoDesk.repositories.openRemote(repo.path) } catch (error) { window.alert(error instanceof Error ? error.message : '打开远程仓库失败') } }
  return <div className="repo-list">{repos.map(repo => <div className={`repo-row ${selectable ? 'repo-row-selectable' : ''}`} key={repo.path}>
    {selectable && <input className="repo-select" type="checkbox" aria-label={`选择 ${repo.name}`} checked={selectedPaths.includes(repo.path)} onChange={() => onToggleSelection?.(repo.path)}/>}
    <button className="repo-open" onClick={() => onSelect(repo)}>
      <div className="repo-symbol"><FolderGit2 size={16}/></div><div className="repo-main"><strong>{repo.name}</strong><span>{repo.path}</span></div>
      <div className="repo-branch"><GitBranch size={13}/>{repo.branch}</div><div className="repo-state"><span className={`state-pill ${repo.changes ? 'dirty' : ''}`}>{repo.changes ? `${repo.changes} 处改动` : '工作区干净'}</span><small>{remoteSummary(repo)}</small><small title={repo.remoteCheckedAt || undefined}>{repo.remoteCheckedAt ? formatFreshness(repo.remoteCheckedAt) : repo.remoteState === 'error' ? '远程状态未更新' : ''}</small></div>
      <div className="repo-commit"><strong>{repo.lastCommit || '暂无提交'}</strong><span>{repo.lastCommitAt}</span></div>
    </button><div className="row-actions"><button title="查看差异并提交改动" aria-label="提交改动" disabled={!repo.changes} onClick={() => onSelect(repo)}><GitCommitHorizontal size={14}/></button><button title="检查远程" aria-label="检查远程" disabled={repo.frozen} onClick={() => onAction(repo, 'refresh')}><RefreshCw size={13}/></button><button title="打开本地目录" aria-label="打开本地目录" onClick={() => window.repoDesk.repositories.openFolder(repo.path)}><ExternalLink size={14}/></button><button title={repo.remoteUrl ? '打开远程仓库' : '未配置远程 origin'} aria-label="打开远程仓库" disabled={!repo.remoteUrl} onClick={() => openRemote(repo)}><Globe2 size={14}/></button><button title={`拉取 ${repo.behind} 个提交`} aria-label="拉取" disabled={Boolean(getBatchSkipReason(repo, 'pull'))} onClick={() => onAction(repo, 'pull')}><ArrowDownToLine size={14}/></button><button title={`推送 ${repo.ahead} 个提交`} aria-label="推送" disabled={Boolean(getBatchSkipReason(repo, 'push'))} onClick={() => onAction(repo, 'push')}><ArrowUpFromLine size={14}/></button>{!compact && <><button title={repo.frozen ? '解除冻结' : '冻结远程更新检查'} aria-label="冻结检查" onClick={() => onFreeze(repo)}>{repo.frozen ? <PlayCircle size={14}/> : <PauseCircle size={14}/>}</button><button title="项目备忘" aria-label="项目备忘" onClick={() => onMemo(repo)}><StickyNote size={14}/></button><button title={favorites.includes(repo.path) ? '取消收藏' : '收藏项目'} aria-label="收藏项目" className={favorites.includes(repo.path) ? 'favorite-active' : ''} onClick={() => onFavorite(repo)}><Star size={14} fill={favorites.includes(repo.path) ? 'currentColor' : 'none'}/></button></>}</div>
  </div>)}</div>
}
function remoteSummary(repo: Repo) { if (repo.frozen || repo.remoteState === 'frozen') return '已冻结更新检查'; if (repo.remoteState === 'unknown') return '等待远程检查'; if (repo.remoteState === 'error') return '检查失败'; if (repo.remoteState === 'no-upstream') return '未配置跟踪分支'; if (repo.remoteState === 'diverged') return `分叉 · ↑${repo.ahead} ↓${repo.behind}`; if (repo.ahead) return `待推送 ↑${repo.ahead}`; if (repo.behind) return `待拉取 ↓${repo.behind}`; return '与远程同步' }
function RepositoryDetail({ repo, onRefresh, onStage, onDiff, diffText, onCommit, commitMessage, setCommitMessage, onPush, onPull, onOpenRemote, onOpenFolder, onMemo, onFavorite, onFreeze, favorite, frozen }: { repo: Repo; onRefresh: () => void; onStage: (files: string[], staged: boolean) => void; onDiff: (file: string, staged: boolean) => void; diffText: string; onCommit: () => void; commitMessage: string; setCommitMessage: (value: string) => void; onPush: () => void; onPull: () => void; onOpenRemote: () => void; onOpenFolder: () => void; onMemo: () => void; onFavorite: () => void; onFreeze: () => void; favorite: boolean; frozen: boolean }) {
  const [identity, setIdentity] = useState<{ globalName: string; globalEmail: string; name: string; email: string; source: 'global' | 'repository' } | null>(null)
  useEffect(() => { window.repoDesk.git.identity(repo.path).then(setIdentity).catch(() => setIdentity(null)) }, [repo.path])
  const staged = repo.files.filter(file => file.staged)
  const unstaged = repo.files.filter(file => file.unstaged)
  return <><section className="settings-panel"><div className="settings-head"><div><h2>{repo.name}</h2><p>{repo.path}</p></div><div className="detail-actions"><button className="button" title="检查远程" onClick={onRefresh}><RefreshCw size={13}/></button><button className="button" title={`拉取 ${repo.behind} 个提交`} disabled={repo.frozen || !repo.behind || repo.ahead > 0 || repo.changes > 0} onClick={onPull}><ArrowDownToLine size={13}/></button><button className="button" title={`推送 ${repo.ahead} 个提交`} disabled={Boolean(getBatchSkipReason(repo, 'push'))} onClick={onPush}><ArrowUpFromLine size={13}/></button><button className="button" title="打开本地目录" onClick={onOpenFolder}><ExternalLink size={13}/></button><button className="button" title="打开远程仓库" disabled={!repo.remoteUrl} onClick={onOpenRemote}><Globe2 size={13}/></button><button className="button" title={favorite ? "取消收藏" : "收藏项目"} onClick={onFavorite}><Star size={13} fill={favorite ? "currentColor" : "none"}/></button><button className="button" title="项目备忘" onClick={onMemo}><StickyNote size={13}/></button><button className="button" title={frozen ? "恢复远程检查" : "冻结远程检查"} onClick={onFreeze}>{frozen ? <PlayCircle size={13}/> : <PauseCircle size={13}/>}</button></div></div><div className="repo-detail-meta"><span><GitBranch size={14}/>{repo.branch}</span><span className={`state-pill ${repo.changes ? 'dirty' : ''}`}>{repo.changes ? `${repo.changes} 处改动` : '工作区干净'}</span><span className="remote-count">{remoteSummary(repo)}</span>{repo.remoteCheckedAt && <small className={Date.now() - new Date(repo.remoteCheckedAt).getTime() > 30 * 60_000 ? 'stale-state' : 'fresh-state'}>{formatFreshness(repo.remoteCheckedAt)}</small>}{repo.operationState && <span className="state-pill operation-state">{repo.operationState}</span>}</div>{identity && <div className="repo-detail-identity">提交身份：<strong>{identity.name || '未配置'} &lt;{identity.email || '未配置'}&gt;</strong><span>来源：{identity.source === 'repository' ? '仓库级覆盖' : '全局配置'}</span></div>}{repo.remoteError && <div className="error-banner">{repo.remoteError}</div>}</section><div className="detail-columns"><section className="settings-panel"><div className="settings-head"><div><h2><FileCode2 size={15}/> 文件改动</h2><p>选择文件查看差异，再暂存要提交的内容</p></div></div><h3 className="change-heading">未暂存 · {unstaged.length}<button className="text-button" disabled={!unstaged.length} onClick={() => onStage(unstaged.map(file => file.path), false)}>全部暂存</button></h3>{unstaged.map(file => <div className="detail-file" key={file.path}><span className="file-status">{file.status}</span><button className="text-button file-name" onClick={() => onDiff(file.path, false)}>{file.path}</button><button className="text-button" onClick={() => onStage([file.path], false)}>暂存</button></div>)}<h3 className="change-heading">已暂存 · {staged.length}<button className="text-button" disabled={!staged.length} onClick={() => onStage(staged.map(file => file.path), true)}>全部取消</button></h3>{staged.map(file => <div className="detail-file" key={file.path}><span className="file-status">{file.status}</span><button className="text-button file-name" onClick={() => onDiff(file.path, true)}>{file.path}</button><button className="text-button" onClick={() => onStage([file.path], true)}>取消暂存</button></div>)}{!repo.files.length && <div className="detail-empty">工作区干净，没有文件改动。</div>}<div className="diff-view"><strong>差异预览</strong><pre>{diffText || '选择文件查看差异；未跟踪文件会在暂存后显示差异。'}</pre></div><div className="commit-box"><textarea placeholder="填写提交说明" value={commitMessage} onChange={event => setCommitMessage(event.target.value)}/><button className="button button-primary" disabled={!staged.length || !commitMessage.trim()} onClick={onCommit}><GitCommitHorizontal size={14}/> 提交已暂存文件</button></div></section><section className="settings-panel"><div className="settings-head"><div><h2><GitCommitHorizontal size={15}/> 最近提交</h2><p>最近五条本地提交记录</p></div></div>{repo.commits.length ? repo.commits.map(commit => <div className="detail-commit" key={commit.hash}><code>{commit.hash}</code><div><strong>{commit.subject}</strong><span>{commit.date}</span></div></div>) : <div className="detail-empty">暂无提交记录。</div>}</section></div></>
}function EmptyState({ onChoose }: { onChoose: () => void }) { return <div className="empty-state"><FolderGit2 size={23}/><strong>还没有发现 Git 仓库</strong><span>检查扫描目录，或选择一个项目根目录。</span><button className="button" onClick={onChoose}>选择项目目录</button></div> }
function NavItem({ label, icon: Icon, active, onClick }: { label: string; icon: typeof LayoutDashboard; active: boolean; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={16}/><span>{label}</span></button> }
export default App



