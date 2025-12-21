import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; // Certifique-se que o arquivo existe
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';

// --- ESTILOS MOBILE (CSS-in-JS) ---
const theme = {
    bg: '#f3f4f6',
    header: '#111827',
    card: '#ffffff',
    primary: '#2563eb', // Azul Waze
    secondary: '#10b981', // Verde Concluir
    textMain: '#1f2937',
    textLight: '#6b7280',
    maps: '#34a853' // Verde Google
};

// Cria DivIcon numerado para o motorista (badge pequena)
function numberedIcon(number) {
    const n = number || '';
    const html = `
        <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#2563eb;color:#fff;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.2);font-size:14px;">
            ${n}
        </div>`;
    return L.divIcon({ html, className: '', iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30] });
}

export default function MobileApp() {
    // Estado do Motorista (Simulado)
    const [motorista] = useState({ id: 1, nome: 'Carlos Oliveira', status: 'Online' });
    const [entregas, setEntregas] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [carregando, setCarregando] = useState(true);

    // Carrega pedidos do Supabase
    useEffect(() => {
        // Ao abrir o app, marca motorista como Online (sincroniza com o dashboard)
        markOnline();
        carregarRota();

        // Atualização em tempo real (Polling simples a cada 5s)
        const intervalo = setInterval(carregarRota, 5000);
        return () => clearInterval(intervalo);
    }, []);

    // Marca o motorista como Online no backend (mock ou real)
    async function markOnline() {
        try {
            const { error } = await supabase.from('frota').update({ status: 'Online' }).eq('id', motorista.id);
            if (error) console.error('[motorista] markOnline: erro ao atualizar frota', error);
            else console.log('[motorista] markOnline: motorista marcado como Online');
        } catch (err) {
            console.error('[motorista] markOnline: exceção', err);
        }
    }

    async function carregarRota() {
        console.log('[motorista] carregarRota: iniciando fetch de pedidos');
        setCarregando(true);
        try {
            // Pega apenas pedidos com status 'Em Rota'
            // Na vida real, filtraria pelo ID do motorista também
            const res = await supabase
                .from('pedidos')
                .select('*')
                .eq('status', 'Em Rota')
                .order('ordem', { ascending: true }); // Ordena pela sequência definida pelo dispatcher (ordem TSP)

            // Em caso do backend/mock não suportar 'ordem', faremos fallback client-side abaixo

            // compatibilidade com mock (res.data) ou com retorno direto
            const data = res && res.data ? res.data : res;
            const error = res && res.error ? res.error : null;

            console.log('[motorista] carregarRota: resultado', { dataPreview: Array.isArray(data) ? data.slice(0, 5) : data, error });

            // Se os itens vierem sem 'ordem', ordena perto->longe usando campo 'ordem' fallback para 'id'
            let finalData = Array.isArray(data) ? data.slice() : [];
            if (finalData.length > 0 && finalData.every(d => d.ordem === undefined)) {
                finalData.sort((a, b) => (a.id || 0) - (b.id || 0));
            } else {
                finalData.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
            }

            if (!error && finalData) {
                setEntregas(finalData);
                setSelectedId(prev => prev || (finalData.length > 0 ? finalData[0].id : null));
            } else if (error) {
                console.error('[motorista] carregarRota: erro do supabase', error);
            }
        } catch (err) {
            console.error('[motorista] carregarRota: exceção', err);
        } finally {
            setCarregando(false);
            console.log('[motorista] carregarRota: fim');
        }
    }

    // Função para abrir GPS
    const abrirGPS = (app, lat, lng) => {
        if (app === 'waze') {
            window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
        } else {
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
        }
    };

    // Função para Finalizar Entrega
    const finalizarEntrega = async (id) => {
        if (!window.confirm("Confirmar entrega realizada?")) return;

        // Atualiza no banco
        const { error } = await supabase
            .from('pedidos')
            .update({ status: 'Entregue' })
            .eq('id', id);

        if (!error) {
            // Remove da lista local instantaneamente para a próxima subir
            const remaining = entregas.filter(item => item.id !== id);
            setEntregas(remaining);
            alert("✅ Entrega confirmada! Carregando a próxima...");

            // Se não houver mais entregas em rota, marca o motorista como disponível
            if (remaining.length === 0) {
                try {
                    const { error: e2 } = await supabase.from('frota').update({ status: 'Online' }).eq('id', motorista.id);
                    if (e2) console.error('[motorista] finalizarEntrega: falha ao atualizar frota', e2);
                    else console.log('[motorista] finalizarEntrega: motorista marcado como Online');
                } catch (err) {
                    console.error('[motorista] finalizarEntrega: exceção atualizando frota', err);
                }
            }
        }
    };

    // Função de debug: semear um pedido de teste no localStorage
    function seedPedido() {
        try {
            const key = 'mock_pedidos';
            const raw = localStorage.getItem(key);
            const arr = raw ? JSON.parse(raw) : [];
            const novo = {
                id: Date.now(),
                cliente: 'Cliente Teste',
                endereco: 'Rua Teste, 123',
                lat: -23.55052,
                lng: -46.633308,
                status: 'Em Rota',
                msg: 'Entrega de teste (seed)'
            };
            arr.push(novo);
            localStorage.setItem(key, JSON.stringify(arr));
            console.log('[motorista] seedPedido: gravado', novo);
            carregarRota();
        } catch (err) {
            console.error('[motorista] seedPedido: erro', err);
        }
    }

    // Remove pedidos de teste do storage e força recarga
    function clearSeeds() {
        try {
            const key = 'mock_pedidos';
            localStorage.removeItem(key);
            console.log('[motorista] clearSeeds: mock_pedidos removido');
            // Também tenta remover do supabase se estiver usando o mock com API
            try {
                // remove pedidos temporários com status 'Em Rota' sem cliente definido? conservador: não executa delete global
            } catch (e) {
                // ignore
            }
            carregarRota();
        } catch (err) {
            console.error('[motorista] clearSeeds: erro', err);
        }
    }

    // A tarefa atual é a selecionada pelo motorista (ou a primeira)
    const tarefaAtual = selectedId ? entregas.find(e => e.id === selectedId) : (entregas.length > 0 ? entregas[0] : null);
    const proximasTarefas = entregas.filter(e => e.id !== (tarefaAtual ? tarefaAtual.id : null));

    // Ordena entregas pela propriedade 'ordem' se presente, senão por id
    const orderedRota = entregas && entregas.slice ? entregas.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)) : [];

    return (
        <div style={{
            minHeight: '100vh',
            backgroundColor: theme.bg,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '480px', // Simula largura de celular se aberto no PC
            margin: '0 auto',
            borderLeft: '1px solid #ddd',
            borderRight: '1px solid #ddd'
        }}>

            {/* 1. HEADER DO MOTORISTA */}
            <header style={{
                backgroundColor: theme.header,
                padding: '20px',
                color: '#fff',
                borderBottomLeftRadius: '20px',
                borderBottomRightRadius: '20px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                zIndex: 10
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '45px', height: '45px', borderRadius: '50%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🧔🏻‍♂️</div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '16px' }}>{motorista.nome}</h2>
                            <span style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>● Online</span>
                        </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{entregas.length}</div>
                            <button
                                onClick={carregarRota}
                                disabled={carregando}
                                title="Atualizar rota"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: '#ffffff22',
                                    color: '#fff',
                                    cursor: carregando ? 'wait' : 'pointer'
                                }}
                            >
                                {carregando ? '...' : '⟳'}
                            </button>
                            <button
                                onClick={() => seedPedido()}
                                title="Semear pedido de teste"
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: '#ffffff22',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '16px'
                                }}
                            >
                                +
                            </button>
                            <button
                                onClick={() => clearSeeds()}
                                title="Remover pedidos de teste"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: '#ffffff22',
                                    color: '#fff',
                                    cursor: 'pointer'
                                }}
                            >
                                🗑️
                            </button>
                        </div>
                        <div style={{ fontSize: '10px', opacity: 0.7 }}>PENDENTES</div>
                    </div>
                </div>
            </header>

            {/* 2. ÁREA PRINCIPAL */}
            <main style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {carregando ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: theme.textLight }}>Buscando rota...</div>
                ) : !tarefaAtual ? (
                    // TELA DE DESCANSO (SEM PEDIDOS)
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: theme.textLight }}>
                        <div style={{ fontSize: '60px', marginBottom: '20px' }}>🎉</div>
                        <h3>Tudo entregue!</h3>
                        <p style={{ textAlign: 'center', maxWidth: '250px' }}>Aguarde o gestor enviar novas rotas.</p>
                        <button onClick={carregarRota} style={{ marginTop: '20px', padding: '10px 20px', background: '#e5e7eb', border: 'none', borderRadius: '20px', fontWeight: 'bold', color: '#374151' }}>Atualizar</button>
                    </div>
                ) : (
                    // CARTÃO DA ENTREGA ATUAL (CARD GIGANTE)
                    <>
                        <div style={{ marginBottom: '10px' }}>
                            <span style={{ background: theme.header, color: '#fff', padding: '5px 12px', borderRadius: '15px', fontSize: '12px', fontWeight: 'bold' }}>PRÓXIMA PARADA</span>
                        </div>

                        <div style={{
                            backgroundColor: theme.card,
                            borderRadius: '24px',
                            padding: '25px',
                            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px'
                        }}>
                            {/* Dados do Cliente */}
                            <div>
                                <h1 style={{ margin: '0 0 5px 0', color: theme.textMain, fontSize: '22px' }}>{tarefaAtual.cliente}</h1>
                                <p style={{ margin: 0, color: theme.textLight, fontSize: '16px', lineHeight: '1.4' }}>📍 {tarefaAtual.endereco}</p>
                            </div>

                            {/* Recado/Obs */}
                            {tarefaAtual.msg && (
                                <div style={{ background: '#fffbeb', padding: '15px', borderRadius: '12px', borderLeft: '4px solid #f59e0b', color: '#92400e', fontSize: '14px' }}>
                                    ⚠️ <strong>Obs:</strong> {tarefaAtual.msg}
                                </div>
                            )}

                            {/* BOTÕES DE NAVEGAÇÃO (GPS) */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                <button
                                    onClick={() => abrirGPS('waze', tarefaAtual.lat, tarefaAtual.lng)}
                                    style={{ padding: '15px', borderRadius: '15px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    🚙 WAZE
                                </button>
                                <button
                                    onClick={() => abrirGPS('maps', tarefaAtual.lat, tarefaAtual.lng)}
                                    style={{ padding: '15px', borderRadius: '15px', border: 'none', background: '#34a853', color: '#fff', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    🗺️ MAPS
                                </button>
                            </div>

                            <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '5px 0' }} />

                            {/* BOTÃO DE FINALIZAR */}
                            <button
                                onClick={() => finalizarEntrega(tarefaAtual.id)}
                                style={{
                                    width: '100%',
                                    padding: '20px',
                                    borderRadius: '18px',
                                    border: 'none',
                                    background: theme.secondary,
                                    color: '#fff',
                                    fontWeight: '800',
                                    fontSize: '18px',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 15px rgba(16, 185, 129, 0.4)',
                                    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px'
                                }}
                            >
                                ✅ FINALIZAR ENTREGA
                            </button>
                        </div>
                    </>
                )}

                {/* MAPA COM BADGES NUMERADOS (apenas visualização rápida) */}
                {orderedRota.length > 0 && (
                    <div style={{ background: '#fff', borderRadius: '12px', padding: '10px', boxShadow: '0 6px 18px rgba(0,0,0,0.06)' }}>
                        <h4 style={{ margin: '8px 0 10px 8px', color: theme.textMain }}>Mapa da Rota</h4>
                        <div style={{ height: '220px', borderRadius: '8px', overflow: 'hidden' }}>
                            <MapContainer center={[orderedRota[0].lat, orderedRota[0].lng]} zoom={13} style={{ width: '100%', height: '100%' }}>
                                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                {orderedRota.map((p, i) => (
                                    <Marker key={p.id} position={[p.lat, p.lng]} icon={numberedIcon(p.ordem || (i + 1))}>
                                        <Popup>
                                            <div style={{ fontWeight: 'bold' }}>{p.ordem || (i + 1)}: {p.cliente}</div>
                                            <div>{p.endereco}</div>
                                        </Popup>
                                    </Marker>
                                ))}
                                {orderedRota.length > 0 && <Polyline positions={orderedRota.map(p => [p.lat, p.lng])} color={theme.primary} weight={4} />}
                            </MapContainer>
                        </div>
                    </div>
                )}

                {/* LISTA DE ENTREGAS (SELECIONÁVEL) */}
                <div style={{ marginTop: '10px' }}>
                    <h4 style={{ margin: '0 0 15px 10px', color: theme.textLight, fontSize: '12px', letterSpacing: '1px' }}>ROTAS DISPONÍVEIS ({entregas.length})</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto', paddingRight: '8px' }}>
                        {entregas.map((task, idx) => {
                            const isSelected = tarefaAtual && tarefaAtual.id === task.id;
                            return (
                                <button
                                    key={task.id}
                                    onClick={() => setSelectedId(task.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '12px 14px',
                                        borderRadius: '12px',
                                        border: isSelected ? `2px solid ${theme.primary}` : '1px solid #edf2f7',
                                        background: isSelected ? '#eef2ff' : '#fff',
                                        cursor: 'pointer',
                                        textAlign: 'left'
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <div style={{ fontWeight: 'bold', color: isSelected ? theme.primary : '#9ca3af', fontSize: '18px' }}>{idx + 1}</div>
                                        <div>
                                            <div style={{ fontWeight: '700' }}>{task.cliente}</div>
                                            <div style={{ fontSize: '12px', color: theme.textLight }}>{task.endereco.substring(0, 40)}</div>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '16px' }}>📦</div>
                                </button>
                            );
                        })}
                    </div>
                </div>

            </main>
        </div>
    );
}