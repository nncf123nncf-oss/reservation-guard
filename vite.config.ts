import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages（https://<user>.github.io/reservation-guard/）に置くため、
  // 相対パス基準を合わせる。ビルド成果物は docs/ に出し、Pages のソースに指定する。
  base: '/reservation-guard/',
  build: {
    outDir: 'docs',
  },
})
