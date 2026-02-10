import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { TimerProvider } from './context/TimerContext' // Import this

ReactDOM.createRoot(document.getElementById('root')).render(
    <TimerProvider> {/* Wrap App inside Provider */}
      <App />
    </TimerProvider>
)