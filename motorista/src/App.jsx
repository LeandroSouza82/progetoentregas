import React, { useState, useEffect, useRef } from 'react';
import DriverApp from './DriverApp';
import supabase from './supabaseClient'; // Certifique-se que o arquivo existe
import { GoogleMap } from '@vis.gl/react-google-maps';
import { AdvancedMarker } from '@vis.gl/react-google-maps';

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM') : 'AIzaSyBeec8r4DWBdNIEFSEZg1CgRxIHjYMV9dM';

function numberedIconUrl(number) {
    const n = number || '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><circle cx='15' cy='15' r='15' fill='%232563eb' stroke='%23fff' stroke-width='2'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23fff' font-family='Arial' font-weight='700'>${n}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// --- ESTILOS MOBILE (CSS-in-JS) ---
const themes = {
    light: {
        bg: '#f3f4f6',
        header: '#111827',
        card: '#ffffff',
        primary: '#2563eb',
        secondary: '#10b981',
        textMain: '#1f2937',
        textLight: '#6b7280',
        maps: '#34a853'
    },
    dark: {
        bg: '#18181b',
        header: '#27272a',
        card: '#23232b',
        primary: '#60a5fa',
        secondary: '#22d3ee',
        textMain: '#f3f4f6',
        textLight: '#a1a1aa',
        maps: '#34a853'
    }
};

// numberedIcon replaced by numberedIconUrl (SVG data URL) for Google Maps

function InternalMobileApp() {
    // Estado da bateria (simulado)
    const [battery, setBattery] = useState({ level: 0.85, charging: false });

    // Simulação de atualização da bateria (pode ser adaptado para API real)
    useEffect(() => {
        const interval = setInterval(() => {
            setBattery(b => {
                let newLevel = b.level - 0.01;
                if (newLevel < 0.1) newLevel = 1;
                return { ...b, level: newLevel };
            });
        }, 10000);
        return () => clearInterval(interval);
    }, []);
    // Estado do Motorista: inicializa a partir da sessão persistida (localStorage)
    const [motorista, setMotorista] = useState(() => {
        try {
            const raw = localStorage.getItem('motorista');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    });
    const [entregas, setEntregas] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    const theme = darkMode ? themes.dark : themes.light;

    // Estado do chat rápido
    const [chatOpen, setChatOpen] = useState(false);
    const [chatMsg, setChatMsg] = useState('');
    const [chatLog, setChatLog] = useState([]);

    // Função para enviar mensagem (simulação)
    function enviarMsgGestor() {
        if (!chatMsg.trim()) return;
        setChatLog(log => [...log, { autor: 'Motorista', texto: chatMsg, ts: new Date().toLocaleTimeString() }]);
        setChatMsg('');
        // Simula resposta do gestor
        setTimeout(() => {
            setChatLog(log => [...log, { autor: 'Gestor', texto: 'Recebido! 👍', ts: new Date().toLocaleTimeString() }]);
        }, 1200);
    }

    // Carrega entregas do Supabase
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
            const motoristaId = motorista && motorista.id ? motorista.id : null;
            if (!motoristaId) {
                console.warn('[motorista] markOnline: motoristaId ausente, não irá marcar online');
                return;
            }
            const { error } = await supabase.from('motoristas').update({ esta_online: true }).eq('id', motoristaId);
            if (error) console.error('[motorista] markOnline: erro ao atualizar motoristas', error);
            else console.log('[motorista] markOnline: motorista marcado como Online');
        } catch (err) {
            console.error('[motorista] markOnline: exceção', err);
        }
    }

    async function carregarRota() {
        console.log('[motorista] carregarRota: iniciando fetch de entregas');
        setCarregando(true);
        try {
            // Pega apenas entregas com status 'Em Rota'
            // Na vida real, filtraria pelo ID do motorista também
            const res = await supabase
                .from('entregas')
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
            .from('entregas')
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
                    const { error: e2 } = await supabase.from('motoristas').update({ esta_online: true }).eq('id', motorista.id);
                    if (e2) console.error('[motorista] finalizarEntrega: falha ao atualizar motoristas', e2);
                    else console.log('[motorista] finalizarEntrega: motorista marcado como Online');
                } catch (err) {
                    console.error('[motorista] finalizarEntrega: exceção atualizando motoristas', err);
                }
            }
        }
    };

    // Função de debug: semear uma entrega de teste no localStorage
    function seedEntrega() {
        try {
            const key = 'mock_entregas';
            const raw = localStorage.getItem(key);
            const arr = raw ? JSON.parse(raw) : [];
            const novo = {
                id: Date.now(),
                cliente: 'Cliente Teste',
                endereco: 'Rua Teste, 123',
                lat: -23.55052,
                lng: -46.633308,
                status: 'Em Rota',
                // campo 'msg' removido — não faz parte do schema real
            };
            arr.push(novo);
            localStorage.setItem(key, JSON.stringify(arr));
            console.log('[motorista] seedEntrega: gravado', novo);
            carregarRota();
        } catch (err) {
            console.error('[motorista] seedEntrega: erro', err);
        }
    }

    // Remove entregas de teste do storage e força recarga
    function clearSeeds() {
        try {
            const key = 'mock_entregas';
            localStorage.removeItem(key);
            console.log('[motorista] clearSeeds: mock_entregas removido');
            // Também tenta remover do supabase se estiver usando o mock com API
            try {
                // remove entregas temporárias com status 'Em Rota' sem cliente definido? conservador: não executa delete global
            } catch (e) {
                // ignore
            }
            carregarRota();
        } catch (err) {
            console.error('[motorista] clearSeeds: erro', err);
        }
    }

    // Função para estimar tempo de entrega (simulação: 8 min por parada)
    function estimarTempoEntrega(ordem) {
        if (!ordem) return '8 min';
        return `${ordem * 8} min`;
    }

    // A tarefa atual é a selecionada pelo motorista (ou a primeira)
    const tarefaAtual = selectedId ? entregas.find(e => e.id === selectedId) : (entregas.length > 0 ? entregas[0] : null);
    const proximasTarefas = entregas.filter(e => e.id !== (tarefaAtual ? tarefaAtual.id : null));

    // Ordena entregas pela propriedade 'ordem' se presente, senão por id
    const orderedRota = entregas && entregas.slice ? entregas.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)) : [];
    const mapRefMobile = useRef(null);
    // SmartLoadScript para evitar múltiplos carregamentos do mesmo script Google Maps
    function SmartLoadScript({ apiKey, children }) {
        if (typeof window !== 'undefined' && window.google && window.google.maps) return <>{children}</>;
        return <LoadScript googleMapsApiKey={apiKey}>{children}</LoadScript>;
    }

    // AdvancedMarker removed: use legacy Marker for mobile map rendering

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
                        <div style={{ width: '45px', height: '45px', borderRadius: '50%', backgroundColor: darkMode ? '#444' : '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', overflow: 'hidden', position: 'relative' }}>
                            <img src={motorista.foto} alt="Foto do motorista" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                            <div style={{ position: 'absolute', bottom: '-8px', right: '-8px', background: battery.level > 0.2 ? '#10b981' : '#f59e0b', color: '#fff', borderRadius: '8px', padding: '2px 6px', fontSize: '10px', fontWeight: 'bold', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
                                {Math.round(battery.level * 100)}% {battery.charging ? '⚡' : ''}
                            </div>
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '16px' }}>{motorista.nome}</h2>
                            <span style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>● Online</span>
                        </div>
                        <button onClick={() => setChatOpen(true)} title="Chat rápido com gestor" style={{ marginLeft: '10px', background: theme.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}>💬 Chat</button>
                    </div>
                    {/* MODAL DE CHAT RÁPIDO */}
                    {chatOpen && (
                        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#0008', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ background: theme.card, borderRadius: '18px', padding: '28px 22px', minWidth: '320px', boxShadow: '0 8px 32px #0004', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '80vh', overflowY: 'auto' }}>
                                <h3 style={{ margin: 0, color: theme.primary }}>Chat com Gestor</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px', maxHeight: '180px', overflowY: 'auto', background: theme.bg, borderRadius: '8px', padding: '8px' }}>
                                    {chatLog.length === 0 && <div style={{ color: theme.textLight, fontSize: '13px' }}>Nenhuma mensagem ainda.</div>}
                                    {chatLog.map((msg, i) => (
                                        <div key={i} style={{ alignSelf: msg.autor === 'Motorista' ? 'flex-end' : 'flex-start', background: msg.autor === 'Motorista' ? theme.primary : theme.secondary, color: '#fff', borderRadius: '8px', padding: '6px 10px', marginBottom: '2px', maxWidth: '80%' }}>
                                            <div style={{ fontSize: '12px', fontWeight: 'bold' }}>{msg.autor}</div>
                                            <div style={{ fontSize: '14px' }}>{msg.texto}</div>
                                            <div style={{ fontSize: '10px', opacity: 0.7, textAlign: 'right' }}>{msg.ts}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input value={chatMsg} onChange={e => setChatMsg(e.target.value)} placeholder="Digite sua mensagem..." style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }} onKeyDown={e => { if (e.key === 'Enter') enviarMsgGestor(); }} />
                                    <button onClick={enviarMsgGestor} style={{ background: theme.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 14px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}>Enviar</button>
                                </div>
                                <button onClick={() => setChatOpen(false)} style={{ marginTop: '8px', background: theme.secondary, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>Fechar</button>
                            </div>
                        </div>
                    )}
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
                                onClick={() => seedEntrega()}
                                title="Semear entrega de teste"
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: '#ffffff22',
                                    color: '#fff',
                                    cursor: 'pointer'
                                }}
                            >
                                +
                            </button>
                            <button
                                onClick={() => clearSeeds()}
                                title="Remover entregas de teste"
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
                    // TELA DE DESCANSO (SEM ENTREGAS)
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
                            {/* Tempo estimado para entrega */}
                            <div style={{ marginBottom: '8px', color: theme.textLight, fontSize: '14px', fontWeight: 'bold' }}>
                                ⏱️ Tempo estimado: {estimarTempoEntrega(tarefaAtual.ordem || 1)}
                            </div>
                            {/* Dados do Cliente */}
                            <div>
                                <h1 style={{ margin: '0 0 5px 0', color: theme.textMain, fontSize: '22px' }}>{tarefaAtual.cliente}</h1>
                                <p style={{ margin: 0, color: theme.textLight, fontSize: '16px', lineHeight: '1.4' }}>📍 {tarefaAtual.endereco}</p>
                            </div>

                            {/* Recado/Obs removido (campo 'msg' não existe) */}

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
                                    borderLeft: darkMode ? '1px solid #222' : '1px solid #ddd',
                                    borderRight: darkMode ? '1px solid #222' : '1px solid #ddd',
                                    transition: 'background 0.3s'
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
                            <SmartLoadScript apiKey={GOOGLE_MAPS_API_KEY}>
                                <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={{ lat: parseFloat(orderedRota[0].lat), lng: parseFloat(orderedRota[0].lng) }} zoom={13} onLoad={m => { if (!mapRefMobile.current) mapRefMobile.current = m; }}>
                                    {orderedRota.map((p, i) => {
                                        if (!mapRefMobile.current || !window.google || !window.google.maps) return null;
                                        const lat = parseFloat(p.lat);
                                        const lng = parseFloat(p.lng);
                                        if (isNaN(lat) || isNaN(lng)) return null;
                                        const num = (p.ordem_logistica != null && Number.isFinite(Number(p.ordem_logistica))) ? Number(p.ordem_logistica) : (p.ordem || (i + 1));
                                        const tipo = String(p.tipo || 'Entrega');
                                        const color = (tipo === 'recolha') ? '#fb923c' : (tipo === 'outros' || tipo === 'outro' ? '#c084fc' : '#2563eb');
                                        return (
                                            <AdvancedMarker key={p.id} position={{ lat, lng }}>
                                                <div style={{ transform: 'translate(-50%,-110%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                    <div style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: '#fff', padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, marginBottom: 6, boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>{tipo.charAt(0).toUpperCase()+tipo.slice(1)}</div>
                                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, boxShadow: '0 4px 10px rgba(0,0,0,0.25)' }}>{String(num)}</div>
                                                </div>
                                            </AdvancedMarker>
                                        );
                                    })}
                                </GoogleMap>
                            </SmartLoadScript>
                            <button onClick={() => setDarkMode(m => !m)} title="Alternar modo" style={{ padding: '6px 10px', borderRadius: '10px', border: 'none', background: darkMode ? '#222' : '#eee', color: darkMode ? '#fff' : '#222', cursor: 'pointer', fontWeight: 'bold' }}>{darkMode ? '🌙' : '☀️'}</button>
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
                                            <div style={{ fontSize: '11px', color: theme.textLight, marginTop: '2px' }}>⏱️ {estimarTempoEntrega(task.ordem || (idx + 1))}</div>
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

export default function App() { return <DriverApp />; }