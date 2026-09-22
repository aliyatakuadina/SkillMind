import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

function appBase(raw: string | undefined) {
  const value = (raw ?? '').trim()
  if (!value || value === '/') return '/'
  const withLead = value.startsWith('/') ? value : `/${value}`
  return withLead.endsWith('/') ? withLead : `${withLead}/`
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: appBase(env.VITE_BASE),
    plugins: [react()],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor',
                test: /node_modules[\\/]/,
              },
            ],
          },
        },
      },
    },
  }
})
