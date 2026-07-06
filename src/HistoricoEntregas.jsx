import React, { useState, useEffect } from 'react';
import { HistoricoService } from './HistoricoService';
import HistoricoCard from './HistoricoCard';

const HistoricoEntregas = ({ theme }) => {
    const [historico, setHistorico] = useState(null);
    const [loading, setLoading] = useState(true);
    // Inicializa com a data de hoje no formato YYYY-MM-DD
    const [filtroData, setFiltroData] = useState(new Date().toISOString().split('T')[0]);
    const [filtroTipo, setFiltroTipo] = useState('Todos');
    const [buscaCliente, setBuscaCliente] = useState('');
    const [erro, setErro] = useState(null);

    // Efeito para buscar dados sempre que a data do filtro ou a busca mudar (com debounce)
    useEffect(() => {
        const carregarDados = async () => {
            setLoading(true);
            try {
                // Se tem buscaCliente, ignora o filtroData (passa null) e busca globalmente
                const termo = buscaCliente.trim();
                let data = [];
                if (termo) {
                    data = await HistoricoService.fetchHistorico(null, termo);
                } else {
                    data = await HistoricoService.fetchHistorico(filtroData, null);
                }
                setHistorico(data);
                setErro(null);
            } catch (err) {
                setErro('Não foi possível carregar o histórico do Supabase.');
            } finally {
                setLoading(false);
            }
        };

        const debounceTimer = setTimeout(() => {
            carregarDados();
        }, 500); // 500ms debounce

        return () => clearTimeout(debounceTimer);
    }, [filtroData, buscaCliente]);

    // ── FUNÇÕES UTILITÁRIAS MANTIDAS PARA O RELATÓRIO DO DIA ──
    const PALAVRAS_FALHA = ['fechado', 'não localizado', 'nao localizado', 'ausente', 'recusou', 'risco', 'outro motivo', 'mudou', 'desconhecido', 'não atende', 'nao atende', 'endereço errado', 'endereco errado'];

    const definirStatusReal = (item) => {
        const statusOriginal = String(item.status || '').toLowerCase();
        if (statusOriginal === 'falha' || statusOriginal === 'erro') return 'falha';

        const campos = [
            item.motivo_nao_entrega, item.tipo_recebedor, item.obs, item.recebedor
        ].map(c => String(c || '').toLowerCase()).join(' ');

        for (const palavra of PALAVRAS_FALHA) {
            if (campos.includes(palavra)) return 'falha';
        }

        return statusOriginal;
    };

    const formatarDataDetalhada = (dataString) => {
        if (!dataString) return { hora: '--:--', dataExtenso: 'Data indisponível', diaMes: '--/--' };
        try {
            const data = new Date(dataString);
            const horaLocal = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(data);
            return { hora: horaLocal };
        } catch (e) {
            return { hora: '--:--' };
        }
    };

    const validarTexto = (txt) => {
        const val = String(txt || '').trim();
        return (val !== "" && val !== "null" && val !== "undefined") ? val : null;
    };

    const getMotivoFinal = (item) => {
        const tecnico = validarTexto(item.motivo_nao_entrega);
        const deslocado = validarTexto(item.tipo_recebedor); 
        const manual = validarTexto(item.obs);

        if (tecnico && (tecnico.toLowerCase() === "outro motivo" || tecnico.toLowerCase() === "outros")) {
            return manual || deslocado || tecnico;
        }

        return tecnico || deslocado || manual || "Não informado";
    };

    const titleCase = (str) => {
        if (!str) return '';
        return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
    };

    const montarRecebedor = (item) => {
        const tipo = validarTexto(item.tipo_recebedor);
        const nome = validarTexto(item.recebedor);
        const obs  = validarTexto(item.obs);

        let textoFinal = '';

        if (tipo) textoFinal += titleCase(tipo);

        if (nome && obs) {
            textoFinal += `${textoFinal ? ' - ' : ''}${titleCase(nome)} (${obs})`;
        } else if (nome) {
            textoFinal += `${textoFinal ? ' - ' : ''}${titleCase(nome)}`;
        } else if (obs) {
            textoFinal += `${textoFinal ? ' - ' : ''}${obs}`;
        }

        return textoFinal || 'Recebedor não informado';
    };

    const getHistoricoFiltrado = () => {
        if (!historico) return [];
        if (filtroTipo === 'Todos') return historico;

        return historico.filter(item => {
            const statusReal = definirStatusReal(item);
            const tipo = String(item.tipo || '').toLowerCase();
            
            if (filtroTipo === 'Falha') return statusReal === 'falha';
            
            // Filtros de categoria apenas para sucessos reais
            if (statusReal === 'falha') return false;
            
            if (filtroTipo === 'Entrega') return tipo.includes('entrega') || tipo === '';
            if (filtroTipo === 'Recolha') return tipo.includes('recolha');
            if (filtroTipo === 'Outros') return !tipo.includes('entrega') && !tipo.includes('recolha');
            
            return true;
        });
    };

    const copiarTudoDoDia = () => {
        const filtrados = getHistoricoFiltrado();
        if (!filtrados || filtrados.length === 0) return;
        
        const labelTipo = filtroTipo === 'Todos' ? '' : ` (${filtroTipo.toUpperCase()})`;
        let textoFinal = `📋 *RELATÓRIO DE ENTREGAS${labelTipo} - ${filtroData || 'HOJE'}*\n\n`;
        
        filtrados.forEach((item, idx) => {
            const { hora } = formatarDataDetalhada(item.data_conclusao || item.created_at);
            const isFalhaItem = definirStatusReal(item) === 'falha';
            
            textoFinal += `${idx + 1}. ${isFalhaItem ? '❌' : '✅'} *${item.cliente || 'Consumidor'}*\n`;
            textoFinal += `   📍 ${item.endereco}\n`;
            if (!isFalhaItem) {
                textoFinal += `   👤 Recebedor: ${montarRecebedor(item)}\n`;
            } else {
                textoFinal += `   ⚠️ Motivo: ${getMotivoFinal(item)}\n`;
            }
            textoFinal += `   ⏰ Horário: ${hora}\n\n`;
        });

        navigator.clipboard.writeText(textoFinal);
        alert(`Relatório com ${filtrados.length} registros (${filtroTipo}) copiado!`);
    };

    // Estilos do container baseados na busca
    const containerStyle = buscaCliente.trim() !== '' 
        ? { display: 'flex', overflowX: 'auto', gap: '24px', paddingBottom: '16px' }
        : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '24px' };

    return (
        <div style={{ padding: '24px', color: '#fff', maxWidth: '1200px', margin: '0 auto', animation: 'fadeIn 0.3s ease-out' }}>
            <style>{`
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                .historico-slider::-webkit-scrollbar { height: 8px; }
                .historico-slider::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 4px; }
                .historico-slider::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
                .historico-slider::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
            `}</style>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                    <div>
                        <h2 style={{ fontSize: '26px', fontWeight: 900, margin: 0, letterSpacing: '-0.5px' }}>Histórico de Atividades</h2>
                        <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '14px' }}>Consulta de entregas concluídas e arquivadas</p>
                    </div>

                    {/* SELETOR DE CATEGORIA (DROPDOWN) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(15,23,42,0.4)', padding: '6px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Tipo:</span>
                        <select 
                            value={filtroTipo}
                            onChange={(e) => setFiltroTipo(e.target.value)}
                            style={{
                                background: '#0f172a',
                                border: '1px solid #334155',
                                borderRadius: '8px',
                                color: filtroTipo === 'Todos' ? '#fff' : '#3B82F6',
                                padding: '4px 8px',
                                outline: 'none',
                                fontWeight: '700',
                                fontSize: '13px',
                                cursor: 'pointer'
                            }}
                        >
                            <option value="Todos">Todos</option>
                            <option value="Entrega">Entrega</option>
                            <option value="Recolha">Recolha</option>
                            <option value="Falha">Falha</option>
                            <option value="Outros">Outros</option>
                        </select>
                    </div>

                    {/* BUSCA INTELIGENTE */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(15,23,42,0.4)', padding: '6px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', minWidth: '280px' }}>
                        <span style={{ color: '#94a3b8', fontSize: '14px' }}>🔍</span>
                        <input 
                            type="text" 
                            placeholder="Buscar cliente, REF ou endereço..."
                            value={buscaCliente}
                            onChange={(e) => setBuscaCliente(e.target.value)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#fff',
                                outline: 'none',
                                flex: 1,
                                fontSize: '13px',
                                fontWeight: 600
                            }}
                        />
                        {buscaCliente && (
                            <button 
                                onClick={() => setBuscaCliente('')}
                                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px', padding: '2px', fontWeight: 900 }}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {historico && historico.length > 0 && (
                        <button 
                            onClick={copiarTudoDoDia}
                            style={{
                                background: '#10b981',
                                border: 'none',
                                color: '#000',
                                padding: '10px 20px',
                                borderRadius: '12px',
                                fontWeight: 800,
                                cursor: 'pointer',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: '0.2s',
                                boxShadow: '0 4px 12px rgba(16,185,129,0.2)'
                            }}
                        >
                            <span>📋</span> COPIAR TUDO DO DIA
                        </button>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(15,23,42,0.4)', padding: '8px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Filtrar Data:</span>
                        <input 
                            type="date" 
                            value={filtroData}
                            onChange={(e) => setFiltroData(e.target.value)}
                            disabled={buscaCliente.trim() !== ''}
                            style={{
                                background: '#0f172a',
                                border: '1px solid #334155',
                                borderRadius: '8px',
                                color: '#fff',
                                padding: '6px 10px',
                                outline: 'none',
                                fontWeight: '600',
                                opacity: buscaCliente.trim() !== '' ? 0.5 : 1,
                                cursor: buscaCliente.trim() !== '' ? 'not-allowed' : 'auto'
                            }}
                        />
                        {filtroData && (
                            <button 
                                onClick={() => setFiltroData('')}
                                disabled={buscaCliente.trim() !== ''}
                                style={{ background: '#334155', border: 'none', color: '#fff', cursor: buscaCliente.trim() !== '' ? 'not-allowed' : 'pointer', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', fontWeight: 700, opacity: buscaCliente.trim() !== '' ? 0.5 : 1 }}
                            >
                                LIMPAR
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {erro && (
                <div style={{ padding: '20px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', color: '#f87171', textAlign: 'center', marginBottom: '20px' }}>
                    ⚠️ {erro}
                </div>
            )}

            {loading && !historico ? (
                <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                    <div className="animate-spin" style={{ width: '40px', height: '40px', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: '#3B82F6', borderRadius: '50%', margin: '0 auto 20px' }}></div>
                    {buscaCliente.trim() !== '' ? 'Buscando histórico global...' : 'Sincronizando Histórico com Supabase...'}
                </div>
            ) : getHistoricoFiltrado().length === 0 ? (
                <div style={{ padding: '80px', textAlign: 'center', background: 'rgba(15,23,42,0.4)', borderRadius: '24px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '56px', marginBottom: '16px', opacity: 0.5 }}>📂</div>
                    <h3 style={{ color: '#f8fafc', margin: '0 0 8px 0' }}>Nenhum registro encontrado</h3>
                    <p style={{ color: '#64748b', margin: 0 }}>
                        {buscaCliente.trim() !== '' 
                            ? `Nenhum resultado para "${buscaCliente}".`
                            : filtroTipo === 'Todos' 
                                ? 'Não há entregas finalizadas para o período selecionado.' 
                                : `Não há registros do tipo "${filtroTipo}" para esta data.`}
                    </p>
                </div>
            ) : (
                <div className="historico-slider" style={containerStyle}>
                    {getHistoricoFiltrado().map(item => (
                        <HistoricoCard key={item.id} item={item} theme={theme} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default HistoricoEntregas;
