import { defineConfig } from 'vite'

// base './' → relative asset URLs; the Pages workflow passes the project path (e.g. /llmspeed/) instead
export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  server: {
    host: true,
  },
})
