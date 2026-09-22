import { useEffect, useState } from 'react'
import {
  activateAiConfigFile,
  cancelAdminAiJob,
  getAdminAiOverview,
  isSkillmindApiConfigured,
  probeAiRoute,
  refreshAiCatalog,
  type AdminAiOverview,
  type AdminAiProbeResult,
} from '../lib/skillmindApi'
import { t } from '../i18n'

export function AdminAiPanel() {
  const [overview, setOverview] = useState<AdminAiOverview | null>(null)
  const [probe, setProbe] = useState<AdminAiProbeResult | null>(null)
  const [loading, setLoading] = useState(isSkillmindApiConfigured())
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    if (!isSkillmindApiConfigured()) return
    setOverview(await getAdminAiOverview())
  }

  useEffect(() => {
    if (!isSkillmindApiConfigured()) return
    let active = true
    void getAdminAiOverview()
      .then((data) => { if (active) setOverview(data) })
      .catch((error: Error) => { if (active) setMessage(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('admin.aiLoadError'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="admin-ai">
      <div className="section-heading">
        <div>
          <h2>{t('admin.aiTitle')}</h2>
          <p className="builder-subtitle">{t('admin.aiSubtitle')}</p>
        </div>
      </div>
      {!isSkillmindApiConfigured() && <p className="builder-subtitle">{t('builder.aiApiMissing')}</p>}
      {message && <div className="notification-banner error" role="alert">{message}</div>}
      {loading && <p>{t('admin.aiLoading')}</p>}
      {overview && (
        <>
          <p className="admin-ai-flags">{t('admin.flagsLocked')}</p>
          <p className="admin-ai-meta">
            {t('admin.fileHash')}: <code>{overview.file.sha256.slice(0, 12)}…</code>
            {' · '}
            {overview.runtime.file_matches_active ? t('admin.hashMatch') : t('admin.hashMismatch')}
          </p>
          <div className="admin-ai-actions">
            <button type="button" className="button button-muted" disabled={Boolean(busy)} onClick={() => void run('catalog', async () => { await refreshAiCatalog(); await load() })}>
              {t('admin.refreshCatalog')}
            </button>
            <button type="button" className="button button-muted" disabled={Boolean(busy)} onClick={() => void run('activate', async () => { await activateAiConfigFile(); await load() })}>
              {t('admin.activateFile')}
            </button>
            <button type="button" className="button" disabled={Boolean(busy)} onClick={() => void run('probe', async () => { setProbe(await probeAiRoute('lecture')) })}>
              {t('admin.probe')}
            </button>
          </div>

          <section className="admin-ai-card">
            <h3>{t('admin.connections')}</h3>
            <div className="teacher-table admin-ai-table">
              <div className="table-head admin-ai-head"><span>{t('admin.connection')}</span><span>{t('admin.provider')}</span><span>{t('admin.keys')}</span><span>{t('admin.models')}</span></div>
              {overview.connections.map((connection) => (
                <div className="table-row admin-ai-head" key={connection.slug}>
                  <div><b>{connection.slug}</b><small>{connection.base_url}</small></div>
                  <span>{connection.provider}</span>
                  <span>{connection.key_aliases.map((item) => `${item.alias} (${item.present ? t('admin.keyPresent') : t('admin.keyMissing')})`).join(', ')}</span>
                  <span>{connection.models.join(', ') || '—'}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-ai-card">
            <h3>{t('admin.routing')}</h3>
            {Object.entries(overview.profiles).map(([profile, candidates]) => (
              <div key={profile} className="admin-ai-route">
                <b>{profile}</b>
                <ol>
                  {candidates.length ? candidates.map((candidate, index) => (
                    <li key={`${profile}-${index}`}>{candidate.provider} · {candidate.key_alias} · {candidate.model_id}</li>
                  )) : <li>{t('admin.noCandidates')}</li>}
                </ol>
              </div>
            ))}
          </section>

          <section className="admin-ai-card">
            <h3>{t('admin.models')}</h3>
            {overview.catalog.length ? (
              <ul className="admin-ai-catalog">
                {overview.catalog.map((item) => (
                  <li key={`${item.connection_slug}-${item.model_id}`}>{item.provider}/{item.model_id} · {item.availability ?? 'unverified'}</li>
                ))}
              </ul>
            ) : <p className="builder-subtitle">{t('admin.catalogEmpty')}</p>}
          </section>

          {probe && (
            <section className="admin-ai-card">
              <h3>{t('admin.probeResult')}</h3>
              <p>{t('admin.outcome')}: {probe.outcome}{probe.winner ? ` · ${probe.winner.provider}/${probe.winner.model_id}` : ''}</p>
              {probe.text && <p className="admin-ai-probe-text">{probe.text}</p>}
              <ol>
                {probe.attempts.map((attempt, index) => (
                  <li key={index}>{attempt.provider} · {attempt.model_id} · {attempt.outcome}</li>
                ))}
              </ol>
            </section>
          )}

          <section className="admin-ai-card">
            <h3>{t('admin.jobs')}</h3>
            {overview.jobs.length ? overview.jobs.map((job) => (
              <div className="admin-ai-job" key={job.id}>
                <span>{job.task_type} · {job.status}</span>
                {job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled' && (
                  <button type="button" className="button button-muted" disabled={Boolean(busy)} onClick={() => void run(`cancel-${job.id}`, async () => { await cancelAdminAiJob(job.id); await load() })}>
                    {t('admin.cancelJob')}
                  </button>
                )}
              </div>
            )) : <p className="builder-subtitle">{t('admin.noJobs')}</p>}
          </section>
        </>
      )}
    </div>
  )
}
