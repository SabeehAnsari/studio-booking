import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useConfig } from '../api/hooks'
import { homeFor, useAuth } from '../auth/context'
import { DemoLogin } from '../components/DemoLogin'
import { Button, Card, ErrorMessage, Field, inputClass } from '../components/ui'

function useNext() {
  const [params] = useSearchParams()
  const next = params.get('next')
  // Only allow in-app relative paths to avoid open redirects.
  return next?.startsWith('/') && !next.startsWith('//') ? next : null
}

function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  const { data: config } = useConfig()
  const next = useNext()
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight">{title}</h1>
      <Card className="p-6">{children}</Card>
      <p className="mt-4 text-center text-sm text-ink-soft">{footer}</p>
      {config?.demo_mode && (
        <div className="mt-10">
          <p className="mb-3 text-sm font-medium text-ink-soft">Or skip the form and explore the demo</p>
          <DemoLogin next={next ?? undefined} />
        </div>
      )}
    </div>
  )
}

export function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const next = useNext()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={next ?? homeFor(user.role)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const u = await login(email, password)
      navigate(next ?? homeFor(u.role))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? new Error('Email or password is incorrect.') : err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          New here?{' '}
          <Link className="font-medium text-brand underline-offset-2 hover:underline" to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email">
          <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorMessage error={error} />
        <Button type="submit" className="w-full" loading={submitting}>
          Log in
        </Button>
      </form>
    </AuthShell>
  )
}

export function Register() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const next = useNext()
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '' })
  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={next ?? homeFor(user.role)} replace />

  const fieldErrors = error instanceof ApiError && error.data && typeof error.data === 'object' ? (error.data as Record<string, string[]>) : {}
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await register(form)
      navigate(next ?? '/appointments')
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Create an account"
      footer={
        <>
          Already have one?{' '}
          <Link className="font-medium text-brand underline-offset-2 hover:underline" to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={fieldErrors.first_name?.[0]}>
            <input className={inputClass} autoComplete="given-name" required value={form.first_name} onChange={set('first_name')} />
          </Field>
          <Field label="Last name" error={fieldErrors.last_name?.[0]}>
            <input className={inputClass} autoComplete="family-name" required value={form.last_name} onChange={set('last_name')} />
          </Field>
        </div>
        <Field label="Email" error={fieldErrors.email?.[0]}>
          <input className={inputClass} type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Phone (optional)" error={fieldErrors.phone?.[0]}>
          <input className={inputClass} type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Password" error={fieldErrors.password?.[0]}>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={set('password')}
          />
        </Field>
        {!Object.keys(form).some((key) => key in fieldErrors) && <ErrorMessage error={error} />}
        <Button type="submit" className="w-full" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthShell>
  )
}
