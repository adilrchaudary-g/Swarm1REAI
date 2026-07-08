import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const useWarRoom = new URLSearchParams(window.location.search).has('warroom')

async function bootstrap() {
  if (useWarRoom) {
    const { default: WarRoomApp } = await import('./WarRoomApp')
    createRoot(document.getElementById('root')!).render(
      <StrictMode><WarRoomApp /></StrictMode>,
    )
  } else {
    await import('./index.css')
    const { default: App } = await import('./App')
    createRoot(document.getElementById('root')!).render(
      <StrictMode><App /></StrictMode>,
    )
  }
}

bootstrap()
