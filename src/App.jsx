import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { supabase } from './supabaseClient';

// --- CONFIGURAÇÃO VISUAL ---
// Ícones (Mantive os mesmos, pois funcionam bem)
const iconBase = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/9131/9131546.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] });
const iconPedido = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/1673/1673221.png', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });
const iconMotorista = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/3097/3097180.png', iconSize: [40, 40], iconAnchor: [20, 40] });

// Cria um DivIcon numerado para exibir a ordem da rota diretamente no marker
function numberedIcon(number) {
    const n = number || '';
    const html = `
        <div style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:#2563eb;color:#fff;font-weight:800;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);">
            ${n}
        </div>`;
    return L.divIcon({ html, className: '', iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] });
}

// Paletas de cores
const lightTheme = {
    headerBg: '#0f172a',
    headerText: '#f8fafc',
    bg: '#f1f5f9',
    card: '#ffffff',
    primary: '#4f46e5',
    accent: '#0ea5e9',
    success: '#10b981',
    danger: '#ef4444',
    textMain: '#334155',
    textLight: '#94a3b8',
    shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
};

const darkTheme = {
    headerBg: '#071028',
    headerText: '#e6eef8',
    bg: '#071228',
    card: '#0b1220',
    primary: '#60a5fa',
    accent: '#38bdf8',
    success: '#34d399',
    danger: '#f87171',
    textMain: '#cbd5e1',
    textLight: '#94a3b8',
    shadow: '0 6px 18px rgba(0,0,0,0.6)'
};

// theme state will be set inside the App component

// --- LÓGICA (NÃO MEXEMOS EM NADA AQUI) ---
function AutoZoom({ pontos }) {
    const map = useMap();
    const prevCount = useRef(0);
    const timeoutRef = useRef(null);

    useEffect(() => {
        if (!pontos || pontos.length === 0) return;

        const bounds = L.latLngBounds(pontos);
        const addedNew = pontos.length > prevCount.current;
        prevCount.current = pontos.length;

        // If a new point was added, first zoom to that point, then expand to fit all
        if (addedNew) {
            const last = pontos[pontos.length - 1];
            try { map.setView(last, 16, { animate: true, duration: 0.6 }); } catch (e) { /* ignore */ }

            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
                try { map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true, duration: 1.0 }); } catch (e) { /* ignore */ }
            }, 700);
        } else {
            try { map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true, duration: 1.0 }); } catch (e) { /* ignore */ }
        }

        return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
    }, [pontos, map]);

    return null;
}

const otimizarRota = (pontoPartida, listaPedidos) => {
    let rotaOrdenada = [];
    let atual = pontoPartida;
    let pendentes = [...listaPedidos];
    while (pendentes.length > 0) {
        let maisProximo = null;
        let menorDistancia = Infinity;
        let indexMaisProximo = -1;
        pendentes.forEach((pedido, index) => {
            const dist = Math.sqrt(Math.pow(pedido.lat - atual[0], 2) + Math.pow(pedido.lng - atual[1], 2));
            if (dist < menorDistancia) {
                menorDistancia = dist;
                maisProximo = pedido;
                indexMaisProximo = index;
            }
        });
        if (maisProximo) {
            rotaOrdenada.push(maisProximo);
            atual = [maisProximo.lat, maisProximo.lng];
            pendentes.splice(indexMaisProximo, 1);
        }
    }
    return rotaOrdenada;
};

export default function App() {
    const [darkMode, setDarkMode] = useState(true);
    const theme = darkMode ? darkTheme : lightTheme;
    const [abaAtiva, setAbaAtiva] = useState('Visão Geral'); // Mudei o nome pra ficar chique
    const [gestorPosicao, setGestorPosicao] = useState([-23.5505, -46.6333]);
    const gestorUpdateTimeoutRef = useRef(null);

    // Estados do Supabase
    const [pedidosEmEspera, setPedidosEmEspera] = useState([]);
    const [frota, setFrota] = useState([]);
    const [rotaAtiva, setRotaAtiva] = useState([]);
    const [motoristaDaRota, setMotoristaDaRota] = useState(null);
    const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'));

    useEffect(() => {
        carregarDados();
        // Tenta obter geolocalização real do gestor no carregamento
        if (navigator && navigator.geolocation) {
            // obtém a posição inicial e começa a observar mudanças (watchPosition)
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    setGestorPosicao([latitude, longitude]);
                },
                (err) => {
                    console.warn('Geolocation init failed:', err.message);
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );

            const watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    setGestorPosicao(prev => {
                        // atualiza apenas se houver mudança significativa
                        if (!prev || prev[0] !== latitude || prev[1] !== longitude) return [latitude, longitude];
                        return prev;
                    });
                },
                (err) => {
                    console.warn('Geolocation watch error:', err.message);
                },
                { enableHighAccuracy: true, maximumAge: 3000, timeout: 7000 }
            );

            // limpa o watch ao desmontar
            return () => {
                try { navigator.geolocation.clearWatch(watchId); } catch (e) { }
            };
        }
    }, []);

    // Envia a posição do gestor para o banco (tabela `frota`) com debounce
    useEffect(() => {
        if (!gestorPosicao || gestorPosicao.length !== 2) return;
        if (gestorUpdateTimeoutRef.current) clearTimeout(gestorUpdateTimeoutRef.current);
        gestorUpdateTimeoutRef.current = setTimeout(async () => {
            try {
                const [lat, lng] = gestorPosicao;
                console.log('[dashboard] atualizando posição do gestor no banco', { lat, lng });
                // Tenta encontrar um registro identificado como Gestor
                const { data: existing, error: selErr } = await supabase.from('frota').select('*').ilike('nome', 'gestor').limit(1);
                if (selErr) console.warn('[dashboard] buscar frota (gestor) falhou', selErr);
                if (existing && existing.length > 0) {
                    const id = existing[0].id;
                    const { error: upErr } = await supabase.from('frota').update({ lat, lng }).eq('id', id);
                    if (upErr) console.warn('[dashboard] falha ao atualizar posição do gestor', upErr);
                } else {
                    // Se não existir, insere um registro simples para o gestor
                    const { error: insErr } = await supabase.from('frota').insert([{ nome: 'Gestor', fone: '', lat, lng, status: 'Online' }]);
                    if (insErr) console.warn('[dashboard] falha ao inserir registro do gestor', insErr);
                }
            } catch (err) {
                console.error('[dashboard] erro ao enviar posição do gestor', err);
            }
        }, 1500);
        return () => { if (gestorUpdateTimeoutRef.current) clearTimeout(gestorUpdateTimeoutRef.current); };
    }, [gestorPosicao]);

    // Ordena a rota ativa pelo campo 'ordem' (caixeiro viajante) para visualização
    const orderedRota = rotaAtiva && rotaAtiva.slice ? rotaAtiva.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0)) : [];

    async function carregarDados() {
        const { data: motoristas } = await supabase.from('frota').select('*');
        if (motoristas) setFrota(motoristas);
        const { data: pedidos } = await supabase.from('pedidos').select('*').eq('status', 'Aguardando');
        if (pedidos) setPedidosEmEspera(pedidos);
    }

    const adicionarAosPendentes = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const lat = gestorPosicao[0] + (Math.random() - 0.5) * 0.04;
        const lng = gestorPosicao[1] + (Math.random() - 0.5) * 0.04;
        const { error } = await supabase.from('pedidos').insert([{
            cliente: fd.get('cliente'), endereco: fd.get('endereco'), msg: fd.get('msg'), tipo: fd.get('tipo') || 'Entrega', lat: lat, lng: lng, status: 'Aguardando'
        }]);
        if (!error) { alert("✅ Salvo com sucesso!"); e.target.reset(); carregarDados(); }
    };

    const excluirPedido = async (id) => {
        const { error } = await supabase.from('pedidos').delete().eq('id', id);
        if (!error) carregarDados();
    };

    const dispararRota = async () => {
        if (pedidosEmEspera.length === 0) return alert("⚠️ Fila vazia.");
        const motoristaDisponivel = frota.find(m => m.status === 'Online');
        if (!motoristaDisponivel) return alert("⚠️ Sem motoristas Online.");

        audioRef.current.play().catch(e => { });
        const rotaOtimizada = otimizarRota(gestorPosicao, pedidosEmEspera);

        await supabase.from('frota').update({ status: 'Ocupado' }).eq('id', motoristaDisponivel.id);
        // Atualiza cada pedido marcando-o como 'Em Rota' e atribuindo a ordem da rota (caixeiro viajante)
        for (let i = 0; i < rotaOtimizada.length; i++) {
            const pedido = rotaOtimizada[i];
            await supabase.from('pedidos').update({ status: 'Em Rota', ordem: i + 1 }).eq('id', pedido.id);
            // atualiza localmente para refletir a ordem no mapa imediato
            rotaOtimizada[i] = { ...pedido, ordem: i + 1 };
        }

        // Mensagem resumida para envio ao app móvel
        let mensagemRota = `🚚 ROTA DO DIA\n\nMotorista: ${motoristaDisponivel.nome}\n\n`;
        rotaOtimizada.forEach((p, i) => { mensagemRota += `${i + 1}. ${p.cliente} — ${p.endereco} \nObs: ${p.msg}\n\n`; });

        // 1) Se disponível, usa Web Share API (bom em dispositivos móveis)
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Rota do Dia', text: mensagemRota });
                // não precisa mais nada
            } catch (e) { /* usuário cancelou ou erro silencioso */ }
        } else {
            // 2) Se houver URL de app móvel configurada, envia via POST (API do app)
            const mobileAppUrl = import.meta.env.VITE_MOBILE_APP_URL;
            if (mobileAppUrl) {
                try {
                    await fetch(mobileAppUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ motorista: motoristaDisponivel, rota: rotaOtimizada, mensagem: mensagemRota })
                    });
                    alert('Rota enviada ao app móvel.');
                } catch (err) {
                    console.error('Erro enviando para app móvel:', err);
                    alert('Falha ao enviar para o app móvel.');
                }
            } else {
                // 3) Fallback: copia para a área de transferência para o usuário colar no app
                try {
                    await navigator.clipboard.writeText(mensagemRota);
                    alert('Mensagem copiada — cole no app móvel.');
                } catch (err) {
                    alert('Não foi possível compartilhar a rota automaticamente.');
                }
            }
        }

        setRotaAtiva(rotaOtimizada);
        setMotoristaDaRota(motoristaDisponivel);
        setAbaAtiva('Visão Geral');
        carregarDados();
    };

    // --- NOVA INTERFACE (AQUI ESTÁ A MUDANÇA VISUAL) ---
    return (
        <div style={{ minHeight: '100vh', backgroundColor: theme.bg, fontFamily: "'Inter', sans-serif", color: theme.textMain }}>

            {/* 1. HEADER SUPERIOR (NAVBAR) */}
            <header style={{
                backgroundColor: theme.headerBg,
                color: theme.headerText,
                padding: '0 40px',
                height: '70px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ width: '35px', height: '35px', background: theme.primary, borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold' }}>LC</div>
                    <h2 style={{ margin: 0, fontSize: '20px', letterSpacing: '1px' }}>LOGI<span style={{ fontWeight: '300', opacity: 0.7 }}>CONTROL</span></h2>
                </div>

                {/* ABAS NO TOPO */}
                <nav style={{ display: 'flex', gap: '10px' }}>
                    {['Visão Geral', 'Nova Carga', 'Central de Despacho', 'Equipe'].map(tab => (
                        <button key={tab} onClick={() => setAbaAtiva(tab)} style={{
                            padding: '10px 20px',
                            background: abaAtiva === tab ? 'rgba(255,255,255,0.1)' : 'transparent',
                            border: abaAtiva === tab ? `1px solid ${theme.primary}` : '1px solid transparent',
                            color: abaAtiva === tab ? theme.primary : '#94a3b8', // Texto colorido quando ativo
                            borderRadius: '20px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '14px',
                            transition: '0.3s'
                        }}>
                            {tab.toUpperCase()}
                        </button>
                    ))}
                </nav>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ textAlign: 'right', fontSize: '12px' }}>
                        <div style={{ color: theme.success, fontWeight: 'bold' }}>● SISTEMA ONLINE</div>
                        <div style={{ opacity: 0.6 }}>São Paulo, BR</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setDarkMode(d => !d)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: theme.headerText, cursor: 'pointer' }}>{darkMode ? 'Modo Claro' : 'Modo Escuro'}</button>
                        <button onClick={async () => {
                            if (navigator && navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (pos) => {
                                        const { latitude, longitude } = pos.coords;
                                        setGestorPosicao([latitude, longitude]);
                                        alert('Posição do gestor atualizada.');
                                    },
                                    (err) => { console.warn('Geolocation failed:', err.message); alert('Não foi possível obter a posição.'); },
                                    { enableHighAccuracy: true, timeout: 5000 }
                                );
                            } else {
                                alert('Geolocalização não suportada neste navegador.');
                            }
                        }} style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: theme.accent, color: '#fff', cursor: 'pointer' }}>Atualizar Posição</button>
                    </div>
                </div>
            </header>

            {/* 2. ÁREA DE CONTEÚDO */}
            <main style={{ maxWidth: '1200px', margin: '40px auto', padding: '0 20px' }}>

                {/* 3. KPIS (ESTATÍSTICAS RÁPIDAS) - Aparecem em todas as telas */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '30px' }}>
                    <CardKPI titulo="PEDIDOS PENDENTES" valor={pedidosEmEspera.length} cor={theme.accent} />
                    <CardKPI titulo="MOTORISTAS ONLINE" valor={frota.filter(m => m.status === 'Online').length} cor={theme.success} />
                    <CardKPI titulo="ROTA ATIVA" valor={rotaAtiva.length > 0 ? 'EM ANDAMENTO' : 'AGUARDANDO'} cor={theme.primary} />
                </div>

                {/* VISÃO GERAL (DASHBOARD) */}
                {abaAtiva === 'Visão Geral' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' }}>

                        {/* MAPA EM CARD (DIMINUÍDO E ELEGANTE) */}
                        <div style={{ background: theme.card, borderRadius: '16px', padding: '10px', boxShadow: theme.shadow, height: '500px' }}>
                            <div style={{ height: '100%', borderRadius: '12px', overflow: 'hidden' }}>
                                <MapContainer center={gestorPosicao} zoom={13} style={{ width: '100%', height: '100%' }}>
                                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                    <AutoZoom pontos={[gestorPosicao, ...orderedRota.map(p => [p.lat, p.lng])]} />
                                    <Marker position={gestorPosicao} icon={iconBase}><Popup>Base</Popup></Marker>
                                    {orderedRota.map((p, i) => (
                                        <Marker key={p.id} position={[p.lat, p.lng]} icon={numberedIcon(p.ordem || (i + 1))}>
                                            <Popup>
                                                <div style={{ fontWeight: 'bold' }}>{p.ordem || (i + 1)}: {p.cliente}</div>
                                                <div>{p.endereco}</div>
                                                <div style={{ marginTop: '6px', fontStyle: 'italic' }}>Obs: {p.msg || 'Sem observações'}</div>
                                            </Popup>
                                        </Marker>
                                    ))}
                                    {orderedRota.length > 0 && <Polyline positions={[gestorPosicao, ...orderedRota.map(p => [p.lat, p.lng])]} color={theme.primary} weight={5} />}
                                </MapContainer>
                            </div>
                        </div>

                        {/* INFO LATERAL */}
                        <div style={{ background: theme.card, borderRadius: '16px', padding: '25px', boxShadow: theme.shadow }}>
                            <h3 style={{ marginTop: 0, color: theme.textMain }}>Status da Operação</h3>
                            {motoristaDaRota ? (
                                <div>
                                    <div style={{ padding: '15px', background: '#e0e7ff', borderRadius: '12px', marginBottom: '20px', color: theme.primary }}>
                                        <strong>🚛 Motorista:</strong> {motoristaDaRota.nome}<br />
                                        <strong>📱 Contato:</strong> {motoristaDaRota.fone}
                                    </div>
                                    <h4 style={{ margin: '10px 0' }}>Próximas Entregas:</h4>
                                    <ul style={{ paddingLeft: '20px', fontSize: '14px', color: theme.textMain }}>
                                        {rotaAtiva.map((p, i) => <li key={p.id} style={{ marginBottom: '8px' }}><strong>{i + 1}.</strong> {p.cliente}</li>)}
                                    </ul>
                                </div>
                            ) : (
                                <p style={{ color: theme.textLight }}>Nenhuma rota despachada no momento.</p>
                            )}
                        </div>
                    </div>
                )}

                {/* NOVA CARGA */}
                {abaAtiva === 'Nova Carga' && (
                    <div style={{ maxWidth: '600px', margin: '0 auto', background: theme.card, padding: '40px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <h2 style={{ textAlign: 'center', color: theme.primary, marginTop: 0 }}>Registrar Encomenda</h2>
                        <form onSubmit={adicionarAosPendentes} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <label style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <span style={{ fontSize: '13px', color: theme.textLight }}>Tipo:</span>
                                <select name="tipo" defaultValue="Entrega" style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                                    <option>Entrega</option>
                                    <option>Recolha</option>
                                </select>
                            </label>
                            <input name="cliente" placeholder="Nome do Cliente" style={inputStyle} required />
                            <input name="endereco" placeholder="Endereço de Entrega" style={inputStyle} required />
                            <textarea name="msg" placeholder="Observações..." rows="4" style={{ ...inputStyle, resize: 'none' }}></textarea>
                            <button type="submit" style={btnStyle(theme.primary)}>ADICIONAR À LISTA</button>
                        </form>
                    </div>
                )}

                {/* CENTRAL DE DESPACHO */}
                {abaAtiva === 'Central de Despacho' && (
                    <div style={{ background: theme.card, padding: '30px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                            <h2>Fila de Preparação</h2>
                            <button onClick={dispararRota} style={{ ...btnStyle(theme.success), width: 'auto' }}>🚀 DISPARAR ROTA (WHATSAPP)</button>
                        </div>
                        {pedidosEmEspera.length === 0 ? <p style={{ textAlign: 'center', color: theme.textLight }}>Tudo limpo! Sem pendências.</p> : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                                {pedidosEmEspera.map(p => (
                                    <div key={p.id} style={{ border: `1px solid #e2e8f0`, padding: '20px', borderRadius: '12px', borderLeft: `4px solid ${theme.accent}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <h4 style={{ margin: '0 0 5px 0' }}>{p.cliente}</h4>
                                            <span style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '12px', background: '#f1f5f9', color: '#374151' }}>{p.tipo || 'Entrega'}</span>
                                        </div>
                                        <p style={{ fontSize: '13px', color: theme.textLight, margin: '4px 0' }}>{p.endereco}</p>
                                        <p style={{ fontSize: '13px', color: theme.textLight, margin: '4px 0' }}><strong>Obs:</strong> {p.msg || 'Sem observações'}</p>
                                        <button onClick={() => excluirPedido(p.id)} style={{ marginTop: '10px', background: 'none', border: 'none', color: theme.danger, cursor: 'pointer', fontSize: '12px' }}>Remover</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* EQUIPE (FROTA) */}
                {abaAtiva === 'Equipe' && (
                    <div style={{ background: theme.card, padding: '30px', borderRadius: '16px', boxShadow: theme.shadow }}>
                        <h2 style={{ marginTop: 0 }}>Motoristas Cadastrados</h2>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '2px solid #f1f5f9', color: theme.textLight }}>
                                    <th style={{ padding: '10px' }}>NOME</th>
                                    <th>STATUS</th>
                                    <th>VEÍCULO</th>
                                    <th>PLACA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {frota.map(m => (
                                    <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '15px 10px', fontWeight: 'bold' }}>{m.nome}</td>
                                        <td><span style={{ padding: '5px 10px', borderRadius: '15px', background: m.status === 'Online' ? '#dcfce7' : '#fee2e2', color: m.status === 'Online' ? '#166534' : '#991b1b', fontSize: '12px', fontWeight: 'bold' }}>{m.status}</span></td>
                                        <td>{m.veiculo}</td>
                                        <td style={{ fontFamily: 'monospace' }}>{m.placa}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

            </main>
        </div>
    );
}

// Componentes Pequenos
function CardKPI({ titulo, valor, cor }) {
    return (
        <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', borderLeft: `5px solid ${cor}` }}>
            <h4 style={{ margin: 0, color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>{titulo}</h4>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#1e293b' }}>{valor}</div>
        </div>
    );
}

const inputStyle = { width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px' };
const btnStyle = (bg) => ({ width: '100%', padding: '15px', borderRadius: '8px', border: 'none', background: bg, color: '#fff', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' });