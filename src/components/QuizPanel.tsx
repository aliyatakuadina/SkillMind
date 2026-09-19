import { useEffect, useState } from 'react'
import { getQuizForLesson, submitQuiz, type QuizData } from '../lib/learningRepository'
import { t } from '../i18n'

export function QuizPanel({ lessonId, onPassed }: { lessonId: string; onPassed: () => Promise<void> }) {
  const [quiz, setQuiz] = useState<QuizData | null>(null)
  const [answers, setAnswers] = useState<Record<string, number | number[]>>({})
  const [score, setScore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getQuizForLesson(lessonId)
      .then((data) => { if (active) setQuiz(data) })
      .catch((caught: Error) => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [lessonId])

  const handleSubmit = async () => {
    if (!quiz || quiz.questions.some((question) => !isCompleteAnswer(question, answers[question.id]))) {
      setError(t('quiz.answerAll'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await submitQuiz(quiz.id, answers)
      setScore(result)
      setQuiz((current) => current ? { ...current, attemptsUsed: current.attemptsUsed + 1, bestScore: Math.max(current.bestScore ?? 0, result) } : current)
      if (result >= quiz.passingScore) await onPassed()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('quiz.submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="quiz-container"><p>{t('quiz.loading')}</p></div>
  if (!quiz) return <div className="quiz-container"><p>{error || t('quiz.notConfigured')}</p></div>
  const attemptsLeft = quiz.attemptLimit == null ? null : Math.max(quiz.attemptLimit - quiz.attemptsUsed, 0)
  const limitReached = attemptsLeft === 0

  return <div className="quiz-container">
    <div className="quiz-header"><span className="quiz-tag">{t('quiz.tag')}</span><h3>{quiz.title}</h3><p>{t('quiz.passingScore', { score: quiz.passingScore })} · {attemptsLeft == null ? t('quiz.unlimited') : t('quiz.attemptsLeft', { count: attemptsLeft })}</p>{quiz.bestScore != null ? <p>{t('quiz.bestScore', { score: quiz.bestScore })}</p> : null}</div>
    {quiz.questions.map((question, questionIndex) => <fieldset className="quiz-question" key={question.id}><legend>{questionIndex + 1}. {question.prompt}</legend><div className="quiz-options">
      {question.type === 'single_choice' && question.options.map((option, optionIndex) => <label className={`quiz-option-item ${answers[question.id] === optionIndex ? 'selected' : ''}`} key={optionIndex}><input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => { setAnswers((current) => ({ ...current, [question.id]: optionIndex })); setScore(null) }} /><span>{option}</span></label>)}
      {question.type === 'multiple_choice' && question.options.map((option, optionIndex) => { const answer = answers[question.id]; const selectedOptions: number[] = Array.isArray(answer) ? answer : []; const selected = selectedOptions.includes(optionIndex); return <label className={`quiz-option-item ${selected ? 'selected' : ''}`} key={optionIndex}><input type="checkbox" checked={selected} onChange={(event) => { setAnswers((current) => { const value = current[question.id]; const previous: number[] = Array.isArray(value) ? value : []; const next = event.target.checked ? [...previous, optionIndex] : previous.filter((item) => item !== optionIndex); return { ...current, [question.id]: next.sort((a, b) => a - b) } }); setScore(null) }} /><span>{option}</span></label> })}
      {question.type === 'matching' && question.leftItems.map((leftItem, leftIndex) => { const answer = answers[question.id]; const current: number[] = Array.isArray(answer) ? answer : []; return <label className="quiz-matching-row" key={`${question.id}-${leftIndex}`}><span>{leftItem}</span><select aria-label={t('quiz.matchFor', { item: leftItem })} value={current[leftIndex] ?? ''} onChange={(event) => { const selectedIndex = Number(event.target.value); setAnswers((answersState) => { const value = answersState[question.id]; const previous: number[] = Array.isArray(value) ? [...value] : Array(question.leftItems.length).fill(-1); previous[leftIndex] = selectedIndex; return { ...answersState, [question.id]: previous } }); setScore(null) }}><option value="">{t('quiz.chooseMatch')}</option>{question.rightItems.map((rightItem, rightIndex) => <option value={rightIndex} key={rightIndex}>{rightItem}</option>)}</select></label> })}
    </div></fieldset>)}
    {error && <div className="form-message error" role="alert">{error}</div>}
    {score != null && <div className={`form-message ${score >= quiz.passingScore ? 'success' : 'error'}`} role="status">{t('quiz.result', { score })} {score >= quiz.passingScore ? t('quiz.passed') : t('quiz.tryAgain')}</div>}
    <button type="button" className="button" disabled={submitting || limitReached} onClick={() => void handleSubmit()}>{submitting ? t('quiz.checking') : limitReached ? t('quiz.noAttempts') : t('quiz.submit')}</button>
  </div>
}

function isCompleteAnswer(question: QuizData['questions'][number], answer: number | number[] | undefined) {
  if (question.type === 'single_choice') return typeof answer === 'number'
  if (question.type === 'multiple_choice') return Array.isArray(answer) && answer.length > 0
  return Array.isArray(answer)
    && answer.length === question.leftItems.length
    && answer.every((value) => value >= 0)
    && new Set(answer).size === answer.length
}
