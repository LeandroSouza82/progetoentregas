import React, { useState, useEffect } from 'react';

export default function AppMotorista() {
  // Sessão do motorista (persistida)
  const [loggedIn, setLoggedIn] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('motorista')) || null;
    } catch (e) { return null; }
  });
  const [entregas, setEntregas] = useState([]);
  const [status, setStatus] = useState("Localizando...");

  // Campos temporários do formulário de login
  const [formNome, setFormNome] = useState(loggedIn ? loggedIn.nome : '');
  const [formPlaca, setFormPlaca] = useState(loggedIn ? loggedIn.veiculo : '');
  const [formFoto, setFormFoto] = useState(loggedIn ? (loggedIn.foto || '') : '');

  function fazerLogin(e) {
    e.preventDefault();
    const sess = { id: Date.now(), nome: formNome || 'Motorista', veiculo: formPlaca || '', foto: formFoto };
    localStorage.setItem('motorista', JSON.stringify(sess));
    setLoggedIn(sess);
    setStatus('Online (logado)');
  }

  function fazerLogout() {
    localStorage.removeItem('motorista');
    setLoggedIn(null);
    setEntregas([]);
    setStatus('Desconectado');
  }
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
        if (!loggedIn) return;
        carregarRota();

        // pedir permissão de notificações (opcional)
        if (window.Notification && Notification.permission !== 'granted') {
            Notification.requestPermission().catch(() => {});
        }

        // GPS - Funciona direto no navegador (Vercel)
        const watchId = navigator.geolocation.watchPosition(
            (p) => {
                setStatus("GPS Online 📍");
                // Em produção você poderia enviar a posição com referência ao motorista
                console.log("Posição do motorista:", p.coords);
            },
            () => setStatus("Erro no GPS ❌"),
            { enableHighAccuracy: true }
        );

        return () => navigator.geolocation.clearWatch(watchId);
    }, [loggedIn]);

    return (
        <div style={{ padding: '20px', background: '#121212', color: '#fff', minHeight: '100vh', fontFamily: 'sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                <div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#00e676' }}>TRUCK GO</div>
                    <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>App Motorista</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {loggedIn ? (
                        <>
                            {loggedIn.foto && <img src={loggedIn.foto} alt="foto" style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #222' }} />}
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '13px', fontWeight: '700' }}>{loggedIn.nome}</div>
                                <div style={{ fontSize: '11px', color: '#aaa' }}>{status}</div>
                            </div>
                            <button onClick={fazerLogout} style={{ marginLeft: '12px', background: '#ff5252', border: 'none', color: '#fff', padding: '8px 10px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }}>Sair</button>
                        </>
                    ) : (
                        <div style={{ fontSize: '12px', color: '#888' }}>{status}</div>
                    )}
                </div>
            </div>

            {!loggedIn && (
                <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.7))', zIndex: 999 }}>
                    <form onSubmit={fazerLogin} style={{ background: '#0f1724', color: '#fff', padding: '28px', borderRadius: '14px', width: '360px', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
                        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>Entrar como Motorista</h2>
                        <p style={{ margin: '0 0 18px 0', color: '#9aa4b2' }}>Insira seus dados para acessar o app</p>
                        <input value={formNome} onChange={e => setFormNome(e.target.value)} placeholder="Nome" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #223344', marginBottom: '10px', background: '#0b1220', color: '#fff' }} />
                        <input value={formPlaca} onChange={e => setFormPlaca(e.target.value)} placeholder="Veículo / Placa" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #223344', marginBottom: '10px', background: '#0b1220', color: '#fff' }} />
                        <input value={formFoto} onChange={e => setFormFoto(e.target.value)} placeholder="URL da foto (opcional)" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #223344', marginBottom: '16px', background: '#0b1220', color: '#fff' }} />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button type="submit" style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: '#00e676', color: '#000', fontWeight: '800', cursor: 'pointer' }}>Entrar</button>
                            <button type="button" onClick={() => { setFormNome(''); setFormPlaca(''); setFormFoto(''); }} style={{ padding: '12px', borderRadius: '10px', border: '1px solid #223344', background: 'transparent', color: '#fff', cursor: 'pointer' }}>Limpar</button>
                        </div>
                    </form>
                </div>
            )}

            {loggedIn && (entregas.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#444', marginTop: '100px' }}>
                    <div style={{ fontSize: '60px' }}>🚛</div>
                    <p>Aguardando novas entregas...</p>
                </div>
            ) : (
                entregas.map((e, i) => (
                    <div key={e.id || i} style={mCard}>
                        <div style={{ color: '#00e676', fontWeight: 'bold', fontSize: '12px' }}>PARADA {i + 1}</div>
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
            ))}
        </div>
    );
}

const mCard = { background: '#1e1e1e', padding: '20px', borderRadius: '15px', marginBottom: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' };
const mBtn = { width: '100%', padding: '15px', background: '#00e676', color: '#000', border: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' };