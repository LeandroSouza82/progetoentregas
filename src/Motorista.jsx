import React, { useState, useEffect } from 'react';
import supabase from './supabaseClient';

export default function AppMotorista() {
  const [entregas, setEntregas] = useState([]);
  const [status, setStatus] = useState('Conectando...');

  // Determine motorista id: read session object from localStorage (no numeric fallback)
  let motoristaId = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem('motorista');
      if (raw) {
        const obj = JSON.parse(raw);
        motoristaId = obj && obj.id ? obj.id : null;
      }
    }
  } catch (e) { motoristaId = null; }

  useEffect(() => {
    let channel = null;
    let isMounted = true;

    async function marcarOnline() {
      try {
        await supabase.from('motoristas').update({ esta_online: true }).eq('id', motoristaId);
        if (isMounted) setStatus('Online');
      } catch (e) {
        console.warn('Erro marcando motorista online:', e);
      }
    }

    async function carregarEntregas() {
      try {
        const { data, error } = await supabase.from('entregas').select('*').eq('motorista_id', motoristaId).eq('status', 'em_rota');
        if (!error && isMounted) setEntregas(data || []);
      } catch (e) { console.warn('Erro carregando entregas:', e); }
    }

    marcarOnline();
    carregarEntregas();

    if (supabase && supabase.channel) {
      try {
        channel = supabase.channel(`motorista-${motoristaId}-entregas`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'entregas', filter: `motorista_id=eq.${motoristaId}` }, (payload) => {
            try {
              const rec = payload.record;
              if (!rec) return;
              if (payload.event === 'DELETE') {
                setEntregas(prev => prev.filter(e => e.id !== rec.id));
                return;
              }
              // Only keep deliveries with status 'em_rota'
              if (rec.status === 'em_rota') {
                setEntregas(prev => {
                  const exists = prev.find(p => p.id === rec.id);
                  if (exists) return prev.map(p => p.id === rec.id ? { ...p, ...rec } : p);
                  return [...prev, rec];
                });
              } else {
                setEntregas(prev => prev.filter(e => e.id !== rec.id));
              }
            } catch (e) { console.warn('Erro no handler realtime:', e); }
          })
          .subscribe();
      } catch (e) {
        console.warn('Erro criando canal Supabase:', e);
      }
    }

    return () => {
      isMounted = false;
      try { if (channel) supabase.removeChannel(channel); } catch (e) { /* ignore */ }
      // marcar offline (best-effort)
      (async () => {
        try { if (motoristaId) await supabase.from('motoristas').update({ esta_online: false }).eq('id', motoristaId); } catch (e) { }
      })();
    };
  }, [motoristaId]);

  const concluirEntrega = async (id) => {
    try {
      const parsed = id;
      if (!parsed) return;
      const { error } = await supabase.from('entregas').update({ status: 'concluido' }).eq('id', parsed);
      if (!error) setEntregas(prev => prev.filter(e => e.id !== parsed));
    } catch (e) { console.warn('Erro concluindo entrega:', e); }
  };

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
          <div key={e.id} style={mCard}>
            <div style={{ color: '#00e676', fontWeight: 'bold', fontSize: '12px' }}>PARADA {i + 1}</div>
            <div style={{ fontSize: '20px', margin: '5px 0' }}>{e.cliente}</div>
            <div style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>📍 {e.endereco}</div>
            <button onClick={() => { concluirEntrega(e.id); }} style={mBtn}>
              CONCLUIR ENTREGA
            </button>
          </div>
        ))
      )}
    </div>
  );
}

const mCard = { background: '#1e1e1e', padding: '20px', borderRadius: '15px', marginBottom: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' };
const mBtn = { width: '100%', padding: '15px', background: '#00e676', color: '#000', border: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '16px' };