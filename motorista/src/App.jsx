import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// --- ZOOM INTELIGENTE ---
function AutoZoom({ posicaoCentral, pedidos }) {
    const map = useMap();
    useEffect(() => {
        const pontos = [];
        if (posicaoCentral) pontos.push(posicaoCentral);
        pedidos.forEach(p => { if (p.posicao) pontos.push(p.posicao); });
        if (pontos.length > 0) {
            const bounds = L.latLngBounds(pontos);
            map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15, animate: true });
        }
    }, [posicaoCentral, pedidos, map]);
    return null;
}

const iconBase = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/619/619153.png', iconSize: [40, 40], iconAnchor: [20, 40] });
const iconPedido = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/1673/1673221.png', iconSize: [35, 35], iconAnchor: [17, 35] });

export default function App() {
    // ESTADOS DE CONFIGURAÇÃO
    const [abaAtiva, setAbaAtiva] = useState('Dashboard');
    const [modoNoturno, setModoNoturno] = useState(false);
    const [tamanhoFonte, setTamanhoFonte] = useState(16); // Tamanho padrão em px
    const [configGestor, setConfigGestor] = useState({
        empresa: 'Minha Corporação Logística',
        apiKey: ''
    });

    const [posicaoCentral, setPosicaoCentral] = useState([-23.5505, -46.6333]);
    const [exibirForm, setExibirForm] = useState(false);
    const [exibirCadastroFrota, setExibirCadastroFrota] = useState(false);
    const [frota, setFrota] = useState([
        { id: 1, motorista: 'João Silva', veiculo: 'Caminhão Baú', placa: 'ABC-1234', status: 'Ativo', celular: '11999999999' }
    ]);
    const [pedidos, setPedidos] = useState([
        { id: '#8842', cliente: 'Magazine Luiza', status: 'Em Trânsito', tipo: 'Entrega', posicao: [-23.5595, -46.6633], valor: '1.250', mensagem: 'Entregar na doca 2' }
    ]);

    const cores = {
        bg: modoNoturno ? '#0b0f1a' : '#f4f7fe',
        card: modoNoturno ? '#161b2d' : '#ffffff',
        texto: modoNoturno ? '#e2e8f0' : '#1b2559',
        primaria: '#4318FF',
        borda: modoNoturno ? '#2d3748' : '#e0e5f2'
    };

    const inputStyle = {
        width: '100%', padding: '12px', borderRadius: '12px', border: `1px solid ${cores.borda}`,
        background: cores.bg, color: cores.texto, marginBottom: '15px', outline: 'none'
    };

    const inputEstilo = (c) => ({
        width: '100%',
        padding: '15px',
        marginBottom: '5px',
        borderRadius: '12px',
        // Borda agora usa a cor primaria com 30% de opacidade para não ficar pesada
        border: `2px solid ${c.primaria}40`,
        backgroundColor: c.fundo || c.bg,
        color: c.texto,
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'all 0.3s ease',
        // Efeito ao clicar no campo
        focusBorder: `2px solid ${c.primaria}`
    });

    const adicionarPedido = (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const novo = {
            id: `#${Math.floor(Math.random() * 900) + 100}`,
            cliente: fd.get('cliente'),
            referencia: fd.get('referencia'), // Novo campo
            tipo: fd.get('tipo'),
            msg: fd.get('msg'),
            status: 'Ativo',
            posicao: [posicaoCentral[0] + (Math.random() - 0.5) * 0.02, posicaoCentral[1] + (Math.random() - 0.5) * 0.02]
        };
        setPedidos([...pedidos, novo]);
        setExibirForm(false);
    };

    const cadastrarNoSistema = (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const novoMotorista = {
            id: Date.now(),
            motorista: fd.get('nome'),
            veiculo: fd.get('modelo'),
            placa: (fd.get('placa') || '').toUpperCase(),
            celular: fd.get('celular'),
            cnh: fd.get('cnh'),
            status: 'Pendente' // Todo novo cadastro começa como pendente para o gestor revisar
        };
        setFrota([novoMotorista, ...frota]);
        setExibirCadastroFrota(false);
        alert('Dados enviados com sucesso! Aguarde a aprovação do gestor.');
    };

    // Função para aprovar o motorista
    const aprovarMotorista = (id) => {
        const novaFrota = frota.map(m => {
            if (m.id === id) {
                return { ...m, status: 'Ativo' };
            }
            return m;
        });
        setFrota(novaFrota);
    };

    // Função para remover motorista (caso os dados estejam errados)
    const removerMotorista = (id) => {
        if (window.confirm('Deseja realmente remover este motorista do sistema?')) {
            setFrota(frota.filter(m => m.id !== id));
        }
    };

    return (
        <div style={{
            display: 'flex', minHeight: '100vh', backgroundColor: cores.bg, color: cores.texto,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: `${tamanhoFonte}px` // AQUI APLICA O TAMANHO DA FONTE GLOBAL
        }}>

            {/* SIDEBAR */}
            <aside style={{ width: '280px', background: cores.card, padding: '30px', borderRight: `1px solid ${cores.borda}` }}>
                <div style={{ marginBottom: '40px' }}>
                    <h2 style={{ color: cores.primaria, margin: 0 }}>{configGestor.empresa.substring(0, 15)}...</h2>
                </div>
                <nav>
                    {['Dashboard', 'Pedidos', 'Frota', 'Configurações'].map(item => (
                        <div key={item} onClick={() => setAbaAtiva(item)} style={{
                            padding: '15px', cursor: 'pointer', borderRadius: '12px', marginBottom: '8px',
                            background: abaAtiva === item ? cores.primaria : 'transparent',
                            color: abaAtiva === item ? '#fff' : cores.texto,
                            fontWeight: 'bold'
                        }}>
                            {item}
                        </div>
                    ))}
                </nav>
            </aside>

            {/* CONTEÚDO */}
            <main style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
                <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px' }}>
                    <h1>{abaAtiva}</h1>
                    <button onClick={() => setExibirForm(true)} style={{ padding: '12px 24px', background: cores.primaria, color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>+ Novo Pedido</button>
                </header>

                {/* ABA DASHBOARD */}
                {abaAtiva === 'Dashboard' && (
                    <div style={{ height: '600px', background: cores.card, borderRadius: '25px', padding: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}>
                        <MapContainer center={posicaoCentral} zoom={13} style={{ height: '100%', width: '100%', borderRadius: '20px' }}>
                            <TileLayer url={modoNoturno ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'} />
                            <AutoZoom posicaoCentral={posicaoCentral} pedidos={pedidos} />
                            <Marker position={posicaoCentral} icon={iconBase} />
                            {pedidos.map(p => (
                                <Marker key={p.id} position={p.posicao} icon={iconPedido}>
                                    <Popup><b>{p.cliente}</b><br />{p.tipo}: {p.mensagem}</Popup>
                                </Marker>
                            ))}
                        </MapContainer>
                    </div>
                )}

                {/* ABA CONFIGURAÇÕES (NOVA) */}
                {abaAtiva === 'Frota' && (
                    <div style={{ animation: 'fadeIn 0.5s ease' }}>
                        <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px', alignItems: 'center' }}>
                            <div>
                                <h2 style={{ fontWeight: '800', margin: 0 }}>Gestão de Frota</h2>
                                <p style={{ fontSize: '12px', opacity: 0.6 }}>{frota.length} motoristas cadastrados no total</p>
                            </div>
                            <button onClick={() => setExibirCadastroFrota(true)} style={{
                                padding: '12px 25px', background: cores.primaria, color: '#fff', border: 'none',
                                borderRadius: '15px', cursor: 'pointer', fontWeight: 'bold', boxShadow: `0 10px 15px -3px ${cores.primaria}40`
                            }}>
                                + Cadastrar Novo Motorista
                            </button>
                        </header>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '25px' }}>
                            {frota.map(v => (
                                <div key={v.id} style={{
                                    background: cores.card, padding: '25px', borderRadius: '30px',
                                    border: v.status === 'Pendente' ? `2px solid #f59e0b` : `1px solid ${cores.borda}`,
                                    boxShadow: '0 15px 35px rgba(0,0,0,0.05)', position: 'relative', transition: '0.3s'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ width: '55px', height: '55px', background: cores.bg, borderRadius: '18px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '24px' }}>
                                            {v.veiculo.toLowerCase().includes('caminhão') ? '🚚' : '🚐'}
                                        </div>
                                        <span style={{
                                            fontSize: '10px', fontWeight: '900', padding: '6px 12px', borderRadius: '10px',
                                            background: v.status === 'Ativo' ? '#10b98120' : '#f59e0b20',
                                            color: v.status === 'Ativo' ? '#10b981' : '#f59e0b',
                                            border: `1px solid ${v.status === 'Ativo' ? '#10b98140' : '#f59e0b40'}`
                                        }}>
                                            {v.status.toUpperCase()}
                                        </span>
                                    </div>

                                    <div style={{ marginTop: '20px' }}>
                                        <h3 style={{ margin: '0 0 5px 0', fontSize: '18px' }}>{v.motorista}</h3>
                                        <p style={{ margin: 0, opacity: 0.6, fontSize: '13px', fontWeight: '600' }}>{v.veiculo} • <span style={{ color: cores.primaria }}>{v.placa}</span></p>
                                        <p style={{ margin: '5px 0 0 0', fontSize: '12px', opacity: 0.5 }}>CNH: {v.cnh || 'Não informada'}</p>
                                    </div>

                                    <div style={{ marginTop: '25px', display: 'flex', gap: '10px' }}>
                                        {/* Se estiver pendente, mostra o botão de Aprovar */}
                                        {v.status === 'Pendente' ? (
                                            <button onClick={() => aprovarMotorista(v.id)} style={{
                                                flex: 2, padding: '12px', borderRadius: '12px', border: 'none',
                                                background: '#10b981', color: '#fff', fontWeight: 'bold', cursor: 'pointer'
                                            }}>
                                                ✓ APROVAR AGORA
                                            </button>
                                        ) : (
                                            <a href={`https://wa.me/${v.celular}`} target="_blank" rel="noreferrer" style={{ flex: 2 }}>
                                                <button style={{
                                                    width: '100%', padding: '12px', borderRadius: '12px', border: `2px solid ${cores.borda}`,
                                                    background: 'transparent', color: cores.texto, fontWeight: 'bold', cursor: 'pointer'
                                                }}>
                                                    💬 WHATSAPP
                                                </button>
                                            </a>
                                        )}

                                        <button onClick={() => removerMotorista(v.id)} style={{
                                            flex: 1, padding: '12px', borderRadius: '12px', border: 'none',
                                            background: '#ef444415', color: '#ef4444', cursor: 'pointer'
                                        }}>
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {abaAtiva === 'Configurações' && (
                    <div style={{ background: cores.card, padding: '30px', borderRadius: '25px', maxWidth: '600px' }}>
                        <h2 style={{ marginBottom: '25px' }}>Preferências do Gestor</h2>

                        {/* CONTROLE DE FONTE */}
                        <div style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: `1px solid ${cores.borda}` }}>
                            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Tamanho da Fonte: {tamanhoFonte}px</label>
                            <input type="range" min="12" max="24" value={tamanhoFonte} onChange={(e) => setTamanhoFonte(e.target.value)} style={{ width: '100%', cursor: 'pointer' }} />
                        </div>

                        {/* CONFIGURAÇÃO DA EMPRESA E API */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <label>
                                <span style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>NOME DA CORPORAÇÃO</span>
                                <input type="text" style={inputStyle} value={configGestor.empresa} onChange={(e) => setConfigGestor({ ...configGestor, empresa: e.target.value })} />
                            </label>

                            <label>
                                <span style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>CHAVE DE API (GOOGLE MAPS/OUTROS)</span>
                                <input type="password" placeholder="Cole sua chave aqui..." style={inputStyle} value={configGestor.apiKey} onChange={(e) => setConfigGestor({ ...configGestor, apiKey: e.target.value })} />
                                <small style={{ opacity: 0.6 }}>Esta chave será usada para serviços premium de geolocalização.</small>
                            </label>

                            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={modoNoturno} onChange={() => setModoNoturno(!modoNoturno)} /> Modo Noturno
                                </label>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* FORMULÁRIO MODAL ATUALIZADO: ENDEREÇO DO DESTINO */}
            {exibirForm && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <form onSubmit={adicionarPedido} style={{
                        backgroundColor: cores.card,
                        padding: '40px',
                        borderRadius: '30px',
                        width: '450px',
                        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                        border: `2px solid ${cores.primaria}` // Moldura na cor do título
                    }}>
                        <h2 style={{ marginBottom: '25px', textAlign: 'center', fontWeight: '800', color: cores.primaria }}>Nova Operação</h2>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: cores.primaria, marginBottom: '5px', display: 'block' }}>NOME DO CLIENTE</label>
                            <input name="cliente" placeholder="Ex: Magazine Luiza" style={inputEstilo(cores)} required />
                        </div>

                        {/* NOVO CAMPO: ENDEREÇO DO DESTINO */}
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: cores.primaria, marginBottom: '5px', display: 'block' }}>ENDEREÇO DO DESTINO</label>
                            <input name="referencia" placeholder="Rua, número, bairro e cidade" style={inputEstilo(cores)} required />
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: cores.primaria, marginBottom: '5px', display: 'block' }}>TIPO DE SERVIÇO</label>
                            <select name="tipo" style={{ ...inputEstilo(cores), border: `2px solid ${cores.primaria}40` }}>
                                <option value="Coleta">📦 Coleta</option>
                                <option value="Entrega">🚚 Entrega</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '700', color: cores.primaria, marginBottom: '5px', display: 'block' }}>MENSAGEM PARA O MOTORISTA</label>
                            <textarea
                                name="msg"
                                placeholder="Descreva as instruções detalhadas aqui..."
                                rows="5"
                                style={{
                                    ...inputEstilo(cores),
                                    resize: 'none',
                                    height: '120px',
                                    lineHeight: '1.5',
                                    border: `2px solid ${cores.primaria}60`
                                }}
                                required
                            ></textarea>
                        </div>

                        <div style={{ display: 'flex', gap: '15px' }}>
                            <button type="button" onClick={() => setExibirForm(false)} style={{
                                flex: 1, padding: '15px', borderRadius: '15px', border: 'none',
                                fontWeight: '700', cursor: 'pointer', background: 'rgba(0,0,0,0.05)', color: cores.texto
                            }}>CANCELAR</button>

                            <button type="submit" style={{
                                flex: 1, padding: '15px', borderRadius: '15px', border: 'none',
                                backgroundColor: cores.primaria, color: '#fff', fontWeight: '700',
                                cursor: 'pointer', boxShadow: `0 10px 15px -3px ${cores.primaria}60`
                            }}>ENVIAR PEDIDO</button>
                        </div>
                    </form>
                </div>
            )}
            {/* MODAL CADASTRO FROTA (SIMULAÇÃO MOBILE) */}
            {exibirCadastroFrota && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
                    <form onSubmit={cadastrarNoSistema} style={{ background: cores.card, padding: '40px', borderRadius: '30px', width: '500px', border: `2px solid ${cores.primaria}`, maxHeight: '90vh', overflowY: 'auto' }}>
                        <h2 style={{ textAlign: 'center', color: cores.primaria, marginBottom: '25px' }}>Cadastro de Motorista</h2>

                        <p style={{ fontSize: '12px', fontWeight: 'bold', color: cores.primaria }}>DADOS PESSOAIS</p>
                        <input name="nome" placeholder="Nome Completo" style={inputEstilo(cores)} required />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input name="celular" placeholder="Celular (WhatsApp)" style={inputEstilo(cores)} required />
                            <input name="cnh" placeholder="Nº CNH" style={inputEstilo(cores)} required />
                        </div>

                        <p style={{ fontSize: '12px', fontWeight: 'bold', color: cores.primaria, marginTop: '15px' }}>DADOS DO VEÍCULO</p>
                        <input name="modelo" placeholder="Modelo (Ex: Fiorino, Volvo FH)" style={inputEstilo(cores)} required />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input name="placa" placeholder="Placa" style={inputEstilo(cores)} required />
                            <input name="ano" placeholder="Ano" type="number" style={inputEstilo(cores)} required />
                        </div>

                        <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
                            <button type="button" onClick={() => setExibirCadastroFrota(false)} style={{ flex: 1, padding: '15px', borderRadius: '15px', border: 'none', cursor: 'pointer' }}>Cancelar</button>
                            <button type="submit" style={{ flex: 1, padding: '15px', borderRadius: '15px', border: 'none', backgroundColor: cores.primaria, color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Finalizar Cadastro</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}