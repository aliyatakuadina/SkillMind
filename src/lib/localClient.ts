const skillmindApiUrl = (import.meta.env.VITE_SKILLMIND_API_URL ?? '').replace(/\/$/, '')
const storageKey = 'skillmind.local.session'

type Listener = (session: LocalSession | null) => void
const listeners = new Set<Listener>()

export interface LocalSession {
  access_token: string
  user: { id: string; email?: string }
}

function readSession(): LocalSession | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LocalSession
  } catch {
    return null
  }
}

function writeSession(session: LocalSession | null) {
  if (session) localStorage.setItem(storageKey, JSON.stringify(session))
  else localStorage.removeItem(storageKey)
  listeners.forEach((listener) => listener(session))
}

async function request(path: string, init: RequestInit = {}, auth = true) {
  const headers = new Headers(init.headers)
  if (auth) {
    const token = readSession()?.access_token
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${skillmindApiUrl}${path}`, { ...init, headers })
  const body = await response.json().catch(() => ({})) as { data?: unknown; error?: string | { message?: string } | null; detail?: string }
  if (!response.ok) {
    const message = body.detail || (typeof body.error === 'string' ? body.error : body.error?.message) || 'request failed'
    return { data: null, error: { message } }
  }
  return { data: body.data ?? null, error: null }
}

class Query {
  private filters: { op: string; column: string; value: unknown }[] = []
  private orderBy: { column: string; ascending: boolean }[] = []
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private table: string
  private op: string
  private columns: string
  private values: unknown
  private onConflict: string | null

  constructor(table: string, op = 'select', columns = '*', values: unknown = null, onConflict: string | null = null) {
    this.table = table
    this.op = op
    this.columns = columns
    this.values = values
    this.onConflict = onConflict
  }

  select(columns = '*') {
    this.columns = columns
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ op: 'eq', column, value })
    return this
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ op: 'in', column, value })
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy.push({ column, ascending: options?.ascending !== false })
    return this
  }

  single() {
    this.mode = 'single'
    return this
  }

  maybeSingle() {
    this.mode = 'maybe'
    return this
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private execute() {
    return request('/v1/data/query', {
      method: 'POST',
      body: JSON.stringify({
        table: this.table,
        op: this.op,
        select: this.columns,
        filters: this.filters,
        order: this.orderBy,
        values: this.values,
        on_conflict: this.onConflict,
        mode: this.mode === 'many' ? null : this.mode,
      }),
    })
  }
}

function storageBucket(bucket: string) {
  return {
    upload(path: string, file: Blob, options?: { contentType?: string }) {
      const form = new FormData()
      form.set('bucket', bucket)
      form.set('path', path)
      form.set('file', file, 'upload')
      if (options?.contentType) form.set('content_type', options.contentType)
      return request('/v1/storage/upload', { method: 'POST', body: form })
    },
    remove(paths: string[]) {
      return request('/v1/storage/remove', { method: 'POST', body: JSON.stringify({ bucket, paths }) })
    },
    list(prefix: string) {
      return request('/v1/storage/list', { method: 'POST', body: JSON.stringify({ bucket, prefix }) })
    },
    createSignedUrl(path: string, expires: number) {
      return request('/v1/storage/sign', { method: 'POST', body: JSON.stringify({ bucket, path, expires }) })
    },
  }
}

export function createLocalClient() {
  return {
    auth: {
      async getSession() {
        return { data: { session: readSession() } }
      },
      async getUser() {
        const session = readSession()
        return { data: { user: session?.user ?? null }, error: session ? null : { message: 'auth required' } }
      },
      async signInWithPassword(input: { email: string; password: string }) {
        const result = await request('/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify(input),
        }, false) as { data: { session?: LocalSession } | null; error: { message: string } | null }
        if (result.error || !result.data?.session) return { data: { session: null }, error: result.error ?? { message: 'auth required' } }
        writeSession(result.data.session)
        return { data: { session: result.data.session }, error: null }
      },
      async signUp(input: { email: string; password: string; options?: { data?: { full_name?: string; role?: string } } }) {
        const result = await request('/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: input.email,
            password: input.password,
            full_name: input.options?.data?.full_name ?? '',
            role: input.options?.data?.role ?? 'student',
          }),
        }, false) as { data: { session?: LocalSession } | null; error: { message: string } | null }
        if (result.error || !result.data?.session) return { data: { session: null }, error: result.error ?? { message: 'auth required' } }
        writeSession(result.data.session)
        return { data: { session: result.data.session }, error: null }
      },
      async signOut() {
        writeSession(null)
      },
      onAuthStateChange(callback: (_event: string, session: LocalSession | null) => void) {
        const listener: Listener = (session) => callback('SIGNED_IN', session)
        listeners.add(listener)
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
      },
    },
    from(table: string) {
      return {
        select(columns?: string) {
          return new Query(table, 'select', columns)
        },
        insert(values: unknown) {
          return new Query(table, 'insert', '*', values)
        },
        update(values: unknown) {
          return new Query(table, 'update', '*', values)
        },
        upsert(values: unknown, options?: { onConflict?: string }) {
          return new Query(table, 'upsert', '*', values, options?.onConflict ?? null)
        },
        delete() {
          return new Query(table, 'delete')
        },
      }
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      const run = (mode?: 'maybe') => request('/v1/data/rpc', {
        method: 'POST',
        body: JSON.stringify({ fn, args: args ?? {}, mode: mode ?? null }),
      })
      return {
        maybeSingle: () => run('maybe'),
        then(
          onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => unknown) | null,
          onrejected?: ((reason: unknown) => unknown) | null,
        ) {
          return run().then(onfulfilled, onrejected)
        },
      }
    },
    storage: {
      from: storageBucket,
    },
  }
}
