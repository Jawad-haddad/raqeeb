import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

export default defineConfig(({ command }) => {
  const config = {
    plugins: [react()],
    server: { port: 5173 },
  }

  // Local HTTPS only — skip on Netlify/CI where the cert files don't exist
  if (command === 'serve' && !process.env.NETLIFY && !process.env.CI) {
    try {
      config.server.https = {
        key:  fs.readFileSync('./localhost-key.pem'),
        cert: fs.readFileSync('./localhost.pem'),
      }
    } catch {
      // cert files missing locally — fall back to HTTP silently
    }
  }

  return config
})
