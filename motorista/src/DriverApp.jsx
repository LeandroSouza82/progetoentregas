import React, { useState } from 'react';

function DriverApp() {
    const [status, setStatus] = useState("Disponível");

    return (
        <div style={{ backgroundColor: '#1e293b', minHeight: '100vh', color: 'white', padding: '20px', fontFamily: 'sans-serif' }}>
            <header style={{ textAlign: 'center', marginBottom: '30px' }}>
                <h2 style={{ color: '#38bdf8' }}>LogiControl <span style={{ color: 'white' }}>Motorista</span></h2>
                <div style={{ background: '#334155', padding: '15px', borderRadius: '12px', marginTop: '20px' }}>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8' }}>Status Atual</p>
                    <h3 style={{ margin: '5px 0', color: status === "Em Entrega" ? '#22c55e' : '#fff' }}>{status}</h3>
                </div>
            </header>

            <main>
                <div style={{ background: 'white', color: '#1e293b', padding: '20px', borderRadius: '16px', marginBottom: '20px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>Próxima Entrega</h4>
                    <p style={{ margin: 0, fontWeight: 'bold' }}>📍 Supermercado Central</p>
                    <p style={{ margin: '5px 0', fontSize: '0.85rem', color: '#64748b' }}>Rua das Flores, 123 - Centro</p>
                    <hr style={{ border: '0.5px solid #eee', margin: '15px 0' }} />
                    <button
                        onClick={() => setStatus("Em Entrega")}
                        style={{ width: '100%', padding: '15px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '1rem' }}
                    >
                        INICIAR ROTA
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    <button style={{ padding: '15px', background: '#334155', color: 'white', border: 'none', borderRadius: '12px' }}>Pausar</button>
                    <button style={{ padding: '15px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '12px' }}>Problema</button>
                </div>

                <div className="content-box" style={{ marginTop: '20px' }}>
                    <h3>Visualização em Tempo Real</h3>
                    <div className="map-container-safe" style={{
                        height: '400px',
                        width: '100%',
                        backgroundColor: '#e2e8f0',
                        borderRadius: '8px',
                        marginTop: '15px',
                        position: 'relative',
                        overflow: 'hidden',
                        backgroundImage: 'url("https://www.google.com/maps/vt/pb=!1m4!1m3!1i13!2i2331!3i5931!2m3!1e0!2sm!3i605206265!3m8!2spt-BR!3sUS!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0!23i4111425")',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        border: '1px solid #cbd5e1'
                    }}>
                        {/* Marcadores Simulados em cima do mapa */}
                        <div title="Motorista João" style={{ position: 'absolute', top: '40%', left: '50%', cursor: 'pointer', fontSize: '24px' }}>📍</div>
                        <div title="Motorista Ricardo" style={{ position: 'absolute', top: '60%', left: '30%', cursor: 'pointer', fontSize: '24px' }}>📍</div>
                        <div title="Carga Atrasada" style={{ position: 'absolute', top: '25%', left: '70%', cursor: 'pointer', fontSize: '24px' }}>⚠️</div>
                        {/* Overlay de Controle do Mapa */}
                        <div style={{
                            position: 'absolute',
                            bottom: '10px',
                            right: '10px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px'
                        }}>
                            <button style={{ width: '30px', height: '30px', border: 'none', borderRadius: '4px', background: 'white', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>+</button>
                            <button style={{ width: '30px', height: '30px', border: 'none', borderRadius: '4px', background: 'white', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>-</button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default DriverApp;