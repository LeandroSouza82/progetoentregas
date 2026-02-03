import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'           // O Dashboard do Gestor
import { APIProvider } from '@vis.gl/react-google-maps'

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

ReactDOM.createRoot(document.getElementById('root')).render(
  // Wrap the whole app in APIProvider so <Map> always has a provider ancestor
  <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
    <App />
  </APIProvider>
);
