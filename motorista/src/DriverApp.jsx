import React, { useState, useEffect } from 'react';

export default function AppMotorista() {
  const [entregas, setEntregas] = useState([]);
  const [status, setStatus] = useState("Localizando...");

  // Função para buscar os dados que já aparecem nos seus logs
  const carregarRota = async () => {
    try {
      console.log("[motorista] carregarRota: iniciando fetch de pedidos");
      // Substitua pela sua URL de API ou lógica de busca do Firebase
      const response = await fetch('SUA_URL_AQUI_OU_LOGICA_FIREBASE');
      const resultado = await response.json();
      
      if (resultado && resultado.dataPreview) {
        setEntregas(resultado.dataPreview);
        console.log("[motorista] carregarRota: resultado", resultado);
      }
    } catch (error) {
      console.error("Erro ao carregar rota:", error);
    } finally {
      console.log("[motorista] carregarRota: fim");
    }
  };

  useEffect(() => {
    carregarRota();

    // GPS - Funciona direto no navegador (Vercel)
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        setStatus("GPS Online 📍");
        // Aqui você enviaria a posição para o Firebase no futuro
      },
      () => setStatus("Erro no GPS ❌"),
      { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return (
    <div style={{ padding: '20px', background: '#121212', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#00e676' }}>TRUCK GO</div>
        <div style={{ fontSize: '12px', color: '#888' }}>{status}</div>
      </div>

      {entregas.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#444', marginTop: '100px' }}>
          <div style={{ fontSize: '60px' }}>🚛</div>
          <p>Aguardando novas entregas...</p>
        </div>
      ) : (
        entregas.map((e, i) => (
          <div key={e.id || i} style={mCard}>
            <div style={{ color: '#00e676', fontWeight: 'bold', fontSize: '12px' }}>PARADA {i+1}</div>
            <div style={{ fontSize: '20px', margin: '5px 0' }}>{e.cliente || 'Cliente'}</div>
            <div style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>📍 {e.endereco || 'Endereço não informado'}</div>
            <button 
              onClick={() => setEntregas(p => p.filter((_, index) => index !== i))} 
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

const mCard = { background: '#1e1e1e', padding: '20px', borderRadius: '15px', marginBottom: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' };
const mBtn = { width: '100%', padding: '15px', background: '#00e676', color: '#000', border: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' };