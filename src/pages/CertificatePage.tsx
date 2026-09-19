import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCertificate, verifyCertificate, type CertificateDetails } from '../lib/learningRepository'
import { t } from '../i18n'

export function CertificatePage({ publicVerification = false }: { publicVerification?: boolean }) {
  const { certificateId, verificationToken } = useParams<{ certificateId?: string; verificationToken?: string }>()
  const [certificate, setCertificate] = useState<CertificateDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const request = publicVerification && verificationToken
      ? verifyCertificate(verificationToken)
      : certificateId ? getCertificate(certificateId) : Promise.resolve(null)
    let active = true
    void request
      .then((data) => { if (active) setCertificate(data) })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [certificateId, publicVerification, verificationToken])

  if (loading) return <section className="page-wrap"><p>{t('certificate.checking')}</p></section>
  if (!certificate) return <section className="page-wrap empty-catalog-state"><span className="empty-icon">⚠</span><h1>{t('certificate.notFound')}</h1><p>{error || t('certificate.checkAddress')}</p>{!publicVerification ? <Link className="button" to="/dashboard">{t('certificate.back')}</Link> : null}</section>

  const issueDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(certificate.issuedAt))
  const verificationUrl = certificate.verificationToken ? `${window.location.origin}/verify/${certificate.verificationToken}` : null

  return (
    <section className="page-wrap certificate-page">
      <div className="certificate-top-bar no-print">{publicVerification ? <span className="text-action">SkillMind LMS</span> : <Link to="/dashboard" className="text-action">← {t('certificate.back')}</Link>}<div className="cert-actions"><button type="button" className="button button-small" onClick={() => window.print()}>{t('certificate.print')}</button></div></div>
      <div className="cert-verification-banner no-print"><span className="verify-icon">✓</span><div><b>{t('certificate.valid')}</b><p>{t('certificate.registry')}</p></div></div>
      <div className="certificate-sheet-container"><article className="certificate-sheet"><div className="cert-inner-border">
        <div className="cert-header"><div className="cert-brand"><span className="cert-brand-mark">S</span><span>SkillMind LMS</span></div><p className="cert-super-title">{t('certificate.heading')}</p></div>
        <div className="cert-body"><p className="cert-presented-to">{t('certificate.presented')}</p><h1 className="cert-student-name">{certificate.studentName}</h1><p className="cert-reason">{t('certificate.reason')}</p><h2 className="cert-course-title">«{certificate.courseTitle}»</h2></div>
        <div className="cert-footer"><div className="cert-meta-item"><small>{t('certificate.issueDate')}</small><strong>{issueDate}</strong></div><div className="cert-seal"><div className="seal-circle"><span>{t('certificate.verifiedSeal')}</span><small>SkillMind</small><span>{new Date(certificate.issuedAt).getFullYear()}</span></div></div><div className="cert-meta-item cert-meta-right"><small>{t('certificate.number')}</small><strong>{certificate.certificateNumber}</strong></div></div>
      </div></article></div>
      {verificationUrl ? <div className="certificate-info-box no-print"><p>{t('certificate.publicLink')}</p><a href={verificationUrl}>{verificationUrl}</a></div> : null}
    </section>
  )
}
