import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css'; // Essencial para o mapa aparecer
import L from 'leaflet';

// --- COMPONENTES AUXILIARES ---

// Componente de ajuste de zoom inteligente para o mapa
function AjustarMapa({ posicaoCentral, pedidos }) {
    const map = useMap();

    useEffect(() => {
        if (!posicaoCentral) return;
        // Filtra apenas pedidos que possuem posição válida
        const pontos = [posicaoCentral, ...pedidos.filter(p => p.posicao).map(p => p.posicao)];

        if (pontos.length > 0) {
            const bounds = L.latLngBounds(pontos);
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    }, [posicaoCentral, pedidos, map]);

    return null;
}

// --- CONFIGURAÇÃO DE ÍCONES ---

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const iconeCentral = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/619/619153.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
});

// --- COMPONENTE PRINCIPAL ---

import './App.css';

function App() {
    // Estados de Localização e Configuração
    const [abaAtiva, setAbaAtiva] = useState('Dashboard');
    const [modoNoturno, setModoNoturno] = useState(false);
    const [posicaoCentral, setPosicaoCentral] = useState([-27.6578, -48.7090]);
    const [pedidos, setPedidos] = useState([
        { id: '#8842', cliente: 'Exemplo 1', status: 'Em Trânsito', posicao: [-27.6500, -48.7000] },
        { id: '#8843', cliente: 'Exemplo 2', status: 'Pendente', posicao: [-27.6700, -48.7200] }
    ]);

    // CAPTURA A GEOLOCALIZAÇÃO AO LIGAR O PROGRAMA
    useEffect(() => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                setPosicaoCentral([position.coords.latitude, position.coords.longitude]);
            }, null, { enableHighAccuracy: true });
        }
    }, []);

    return (
        <div className={`app-container ${modoNoturno ? 'dark' : ''}`} style={{ display: 'flex', minHeight: '100vh' }}>
            {/* SIDEBAR (SIMPLIFICADA) */}
            <aside style={{ width: '250px', background: modoNoturno ? '#1e293b' : '#fff', padding: '20px', borderRight: '1px solid #ddd' }}>
                <h2>🚚 LogiControl</h2>
                <button onClick={() => setAbaAtiva('Dashboard')} style={{ width: '100%', padding: '10px', marginBottom: '10px' }}>Painel Geral</button>
                <button onClick={() => setAbaAtiva('Pedidos')} style={{ width: '100%', padding: '10px' }}>Pedidos</button>
                <div style={{ marginTop: '20px' }}>
                    <label><input type="checkbox" onChange={() => setModoNoturno(!modoNoturno)} /> Modo Noturno</label>
                </div>
            </aside>

            {/* CONTEÚDO PRINCIPAL */}
            <main style={{ flex: 1, padding: '20px', background: modoNoturno ? '#0f172a' : '#f8fafc' }}>
                {abaAtiva === 'Dashboard' && (
                    <div className="fade-in">
                        <h1>Dashboard de Frota</h1>

                        {/* INDICADORES */}
                        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
                            <div className="kpi-card">Total: {pedidos.length}</div>
                            <div className="kpi-card">Sua Base: {posicaoCentral[0].toFixed(4)}</div>
                        </div>

                        {/* MAPA COM ZOOM AUTOMÁTICO */}
                        <div style={{ height: '600px', borderRadius: '15px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                            <MapContainer
                                center={posicaoCentral}
                                zoom={13}
                                style={{ height: '100%', width: '100%' }}
                                markerZoomAnimation={true}
                            >
                                <TileLayer url={modoNoturno ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'} />

                                {/* ATIVA O ZOOM AUTOMÁTICO DINÂMICO */}
                                <AutoZoom posicaoCentral={posicaoCentral} pedidos={pedidos} />

                                {/* ÍCONE DA SUA BASE (CASINHA) - SEM PONTO AZUL */}
                                <Marker position={posicaoCentral} icon={iconeBase}>
                                    <Popup>Minha Central</Popup>
                                </Marker>

                                {/* ÍCONES DOS PEDIDOS */}
                                {pedidos.map(p => (
                                    <Marker key={p.id} position={p.posicao} icon={iconePedido}>
                                        <Popup><b>{p.cliente}</b><br />{p.id}</Popup>
                                    </Marker>
                                ))}
                            </MapContainer>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}


export default App;