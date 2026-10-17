import { render } from 'preact'
import { App } from './app'
import './styles.css'

const root = document.getElementById('app')!
// drop the prerendered landing-page HTML (crawler content); the app renders the same section itself
root.textContent = ''
render(<App />, root)
