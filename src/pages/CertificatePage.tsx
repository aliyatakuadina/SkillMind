import { Link, useParams } from 'react-router-dom'
import { mockCertificates } from '../data/mockData'

export function CertificatePage() {
  const { certificateId } = useParams<{ certificateId: string }>()

  const cert =
    mockCertificates.find((c) => c.id === certificateId) ?? mockCertificates[0]

  const handlePrint = () => {
    window.print()
  }

  return (
    <section className="page-wrap certificate-page">
      <div className="certificate-top-bar no-print">
        <Link to="/dashboard" className="text-action">
          ← Вернуться в кабинет
        </Link>
        <div className="cert-actions">
          <button type="button" className="button button-small" onClick={handlePrint}>
            🖨️ Распечатать / Сохранить в PDF
          </button>
        </div>
      </div>

      {/* Verification Banner */}
      <div className="cert-verification-banner no-print">
        <span className="verify-icon">✓</span>
        <div>
          <b>Сертификат подлинный</b>
          <p>
            Выдан платформой SkillMind LMS. Запись верифицирована в реестре сертификатов.
          </p>
        </div>
      </div>

      {/* Physical Certificate Sheet Container */}
      <div className="certificate-sheet-container">
        <article className="certificate-sheet">
          <div className="cert-inner-border">
            <div className="cert-header">
              <div className="cert-brand">
                <span className="cert-brand-mark">S</span>
                <span>SkillMind LMS</span>
              </div>
              <p className="cert-super-title">СЕРТИФИКАТ О ПРОХОЖДЕНИИ КУРСА</p>
            </div>

            <div className="cert-body">
              <p className="cert-presented-to">Настоящим подтверждается, что</p>
              <h1 className="cert-student-name">{cert.studentName}</h1>
              <p className="cert-reason">
                успешно освоил(а) учебную программу и выполнил(а) все практические задания курса
              </p>
              <h2 className="cert-course-title">«{cert.courseTitle}»</h2>
              <p className="cert-grade">С результатом: <strong>{cert.grade}</strong></p>
            </div>

            <div className="cert-footer">
              <div className="cert-meta-item">
                <small>Дата выдачи</small>
                <strong>{cert.issueDate}</strong>
              </div>

              <div className="cert-seal">
                <div className="seal-circle">
                  <span>VERIFIED</span>
                  <small>SkillMind</small>
                  <span>2026</span>
                </div>
              </div>

              <div className="cert-meta-item cert-meta-right">
                <small>Уникальный номер</small>
                <strong>{cert.id}</strong>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div className="certificate-info-box no-print">
        <p>
          Данный цифровой сертификат подтверждает владение навыками проектирования пользовательского опыта. Для
          проверки подлинности работодатели могут перейти по этой ссылке.
        </p>
      </div>
    </section>
  )
}
