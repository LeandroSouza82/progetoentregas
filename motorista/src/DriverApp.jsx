
import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

// Mudança: Tenta conectar, mas não trava o app se o IP estiver offline
const socket = io('http://192.168.2.127:3000', { 
  transports: ['websocket'],
  timeout: 5000 
});

export default function AppMotorista() {
  const [entregas, setEntregas] = useState([]);
  const [status, setStatus] = useState("Localizando...");

  useEffect(() => {
    // Escutar eventos do socket
    socket.on('connect', () => setStatus("Conectado ao Servidor ✅"));
    socket.on('connect_error', () => setStatus("Servidor Offline (Local) ⚠️"));

    socket.on('NOVA_ROTA', (d) => { 
      setEntregas(d.entregas); 
      alert("🔔 Nova rota recebida!"); 
    });

    socket.on('ENTREGA_CONCLUIDA', (d) => 
      setEntregas(p => p.filter(e => e.id !== d.id))
    );
    
    // GPS
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude } = p.coords;
        socket.emit('posicao_motorista', { lat: latitude, lng: longitude });
        setStatus("GPS Online 📍");
        console.log("Posição enviada:", latitude, longitude);
      },
      (err) => {
        console.error(err);
        setStatus("Erro no GPS ❌");
      },
      { enableHighAccuracy: true, distanceFilter: 10 }
    );

    return () => {
      socket.off();
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return (
    <div style={{ padding: '20px', background: '#121212', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#00e676', letterSpacing: '2px' }}>TRUCK GO</div>
        <div style={{ fontSize: '11px', color: '#888', marginTop: '5px', textTransform: 'uppercase' }}>{status}</div>
      </div>

      {entregas.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#333', marginTop: '100px' }}>
          <div style={{ fontSize: '80px', marginBottom: '10px' }}>🚛</div>
          <p style={{ color: '#666' }}>Aguardando novas rotas do painel...</p>
        </div>
      ) : (
        entregas.map((e, i) => (
          <div key={e.id || i} style={mCard}>
            <div style={{ color: '#00e676', fontWeight: 'bold', fontSize: '11px' }}>PARADA {i+1}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', margin: '8px 0' }}>{e.cliente}</div>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '20px', lineHeight: '1.4' }}>📍 {e.endereco}</div>
            <button 
              onClick={() => { 
                socket.emit('entrega_feita', e.id); 
                setEntregas(p => p.filter(x => x.id !== e.id)); 
              }} 
              style={mBtn}
            >
              CONCLUIR ENTREGA
            </button>
          </div>
        ))
      )}
    </div>
  );
}

const mCard = { 
  background: '#1e1e1e', 
  padding: '20px', 
  borderRadius: '16px', 
  marginBottom: '15px', 
  border: '1px solid #333',
  boxShadow: '0 4px 20px rgba(0,0,0,0.4)' 
};

const mBtn = { 
  width: '100%', 
  padding: '16px', 
  background: '#00e676', 
  color: '#000', 
  border: 'none', 
  borderRadius: '12px', 
  fontWeight: 'bold', 
  fontSize: '15px',
  cursor: 'pointer'
};