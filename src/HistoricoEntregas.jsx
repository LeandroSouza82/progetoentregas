import React, { useState, useEffect } from 'react';
import { HistoricoService } from './HistoricoService';

const HistoricoEntregas = ({ theme }) => {
    const [historico, setHistorico] = useState(null);
    const [loading, setLoading] = useState(true);
    // Inicializa com a data de hoje no formato YYYY-MM-DD
    const [filtroData, setFiltroData] = useState(new Date().toISOString().split('T')[0]);
    const [erro, setErro] = useState(null);

    // Efeito para buscar dados sempre que a data do filtro mudar
    useEffect(() => {
        const carregarDados = async () => {
            setLoading(true);
            try {
                const data = await HistoricoService.fetchHistorico(filtroData);
                setHistorico(data);
                setErro(null);
            } catch (err) {
                setErro('Não foi possível carregar o histórico do Supabase.');
            } finally {
                setLoading(false);
            }
        };

        carregarDados();
    }, [filtroData]);

    const getCardColor = (tipo, status) => {
        const s = String(status || '').toLowerCase();
        if (s === 'falha') return '#ef4444'; // Vermelho para falhas

        const t = String(tipo || '').toLowerCase();
        if (t.includes('recolha')) return '#F59E0B'; // Laranja
        if (t.includes('serviço') || t.includes('outro') || t.includes('coleta')) return '#8B5CF6'; // Lilás
        return '#3B82F6'; // Azul (Padrão: Entrega)
    };

    // Log de confirmação solicitado para validar recebimento no F12
    if (historico) {
        console.log("📊 Registros históricos encontrados:", historico.length);
    }

    const formatarDataDetalhada = (dataString) => {
        if (!dataString) return { hora: '--:--', dataExtenso: 'Data indisponível', diaMes: '--/--' };
        try {
            const data = new Date(dataString);
            
            // Ex: "Segunda-feira, 04 de Maio"
            const diaSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(data);
            const diaMesCurto = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(data);
            const diaMesExtenso = new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(data);
            const nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(data);
            
            const diaSemanaCap = diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1);
            const nomeMesCap = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);

            return {
                hora: data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                dataExtenso: `${diaSemanaCap}, ${diaMesExtenso} de ${nomeMesCap}`,
                diaMes: diaMesCurto,
                diaSemana: diaSemanaCap
            };
        } catch (e) {
            return { hora: '--:--', dataExtenso: 'Erro na data', diaMes: '--/--' };
        }
    };

    const getNomeExibicao = (item) => {
        const tipo = item.tipo_recebedor ? String(item.tipo_recebedor).trim() : null;
        const nome = (item.recebedor || item.obs) ? String(item.recebedor || item.obs).trim() : null;
        
        let resultado = '';
        if (tipo && nome) {
            // Caso tenha ambos: "Porteiro - Adriano"
            resultado = `${tipo} - ${nome}`;
        } else if (tipo) {
            // Caso tenha apenas o tipo: "Porteiro"
            resultado = tipo;
        } else if (nome) {
            // Caso tenha apenas o nome: "Adriano"
            resultado = nome;
        } else {
            return 'Recebedor não informado';
        }

        // Destaque para tipos genéricos conhecidos
        const resUpper = resultado.toUpperCase();
        if (resUpper.includes('CORREIO') || resUpper.includes('MORADOR')) {
            return `🚩 ${resultado}`;
        }
        
        return resultado;
    };

    const copiarParaWhatsApp = (item) => {
        const { hora, dataExtenso } = formatarDataDetalhada(item.data_conclusao || item.created_at);
        const statusLabel = String(item.status || '').toLowerCase() === 'falha' ? '*FALHA NA ENTREGA* ❌' : '*ENTREGA CONCLUÍDA* ✅';
        const nomeExibicao = getNomeExibicao(item);
        
        let texto = `${statusLabel}\n`;
        texto += `📍 *Local:* ${item.endereco}\n`;
        
        if (String(item.status || '').toLowerCase() !== 'falha') {
            texto += `👤 *Recebedor:* ${nomeExibicao}\n`;
        } else if (item.motivo_nao_entrega) {
            texto += `⚠️ *Motivo:* ${item.motivo_nao_entrega}\n`;
        }

        texto += `⏰ *Horário:* ${hora}\n`;
        texto += `📅 *Data:* ${dataExtenso}\n`;

        navigator.clipboard.writeText(texto);
        alert('Copiado para o WhatsApp!');
    };

    const copiarTudoDoDia = () => {
        if (!historico || historico.length === 0) return;
        
        let textoFinal = `📋 *RELATÓRIO DE ENTREGAS - ${filtroData || 'HOJE'}*\n\n`;
        
        historico.forEach((item, idx) => {
            const { hora } = formatarDataDetalhada(item.data_conclusao || item.created_at);
            const isFalha = String(item.status || '').toLowerCase() === 'falha';
            const nomeExibicao = getNomeExibicao(item);
            
            textoFinal += `${idx + 1}. ${isFalha ? '❌' : '✅'} *${item.cliente || 'Consumidor'}*\n`;
            textoFinal += `   📍 ${item.endereco}\n`;
            if (!isFalha) {
                textoFinal += `   👤 Recebedor: ${nomeExibicao}\n`;
            }
            textoFinal += `   ⏰ ${hora}${isFalha && item.motivo_nao_entrega ? ` - Motivo: ${item.motivo_nao_entrega}` : ''}\n\n`;
        });

        navigator.clipboard.writeText(textoFinal);
        alert(`Relatório com ${historico.length} registros copiado!`);
    };

    if (loading && !historico) {
        return (
            <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                <div className="animate-spin" style={{ width: '40px', height: '40px', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: '#3B82F6', borderRadius: '50%', margin: '0 auto 20px' }}></div>
                Sincronizando Histórico com Supabase...
            </div>
        );
    }

    return (
        <div style={{ padding: '24px', color: '#fff', maxWidth: '1200px', margin: '0 auto', animation: 'fadeIn 0.3s ease-out' }}>
            <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '20px' }}>
                <div>
                    <h2 style={{ fontSize: '26px', fontWeight: 900, margin: 0, letterSpacing: '-0.5px' }}>Histórico de Atividades</h2>
                    <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '14px' }}>Consulta de entregas concluídas e arquivadas</p>
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
                            style={{
                                background: '#0f172a',
                                border: '1px solid #334155',
                                borderRadius: '8px',
                                color: '#fff',
                                padding: '6px 10px',
                                outline: 'none',
                                fontWeight: '600'
                            }}
                        />
                        {filtroData && (
                            <button 
                                onClick={() => setFiltroData('')}
                                style={{ background: '#334155', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', fontWeight: 700 }}
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

            {!loading && historico?.length === 0 ? (
                <div style={{ padding: '80px', textAlign: 'center', background: 'rgba(15,23,42,0.4)', borderRadius: '24px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '56px', marginBottom: '16px', opacity: 0.5 }}>📂</div>
                    <h3 style={{ color: '#f8fafc', margin: '0 0 8px 0' }}>Nenhum registro encontrado</h3>
                    <p style={{ color: '#64748b', margin: 0 }}>Não há entregas finalizadas para o período selecionado.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '24px' }}>
                    {historico?.map(item => {
                        const { hora, dataExtenso } = formatarDataDetalhada(item.data_conclusao || item.created_at);
                        const isFalha = String(item.status || '').toLowerCase() === 'falha';
                        const cor = getCardColor(item.tipo, item.status);
                        
                        return (
                            <div key={item.id} style={{
                                background: theme.card,
                                border: isFalha ? `2px solid #ef4444` : `1px solid rgba(255,255,255,0.03)`,
                                borderRadius: '20px',
                                padding: '24px',
                                position: 'relative',
                                overflow: 'hidden',
                                boxShadow: isFalha ? '0 0 20px rgba(239,68,68,0.15)' : '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
                                transition: 'all 0.2s ease'
                            }}>
                                <div style={{ 
                                    position: 'absolute', 
                                    top: 0, 
                                    left: 0, 
                                    width: '6px', 
                                    height: '100%', 
                                    background: cor 
                                }} />
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <div style={{ 
                                        padding: '4px 10px', 
                                        borderRadius: '6px', 
                                        background: `${cor}15`, 
                                        color: cor,
                                        fontSize: '11px',
                                        fontWeight: 900,
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px',
                                        border: `1px solid ${cor}30`
                                    }}>
                                        {isFalha ? '⚠️ FALHA' : (item.tipo || 'Entrega')}
                                    </div>
                                    <button 
                                        onClick={() => copiarParaWhatsApp(item)}
                                        title="Copiar para WhatsApp"
                                        style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px', borderRadius: '8px', fontSize: '16px' }}
                                    >
                                        📲
                                    </button>
                                </div>

                                <h3 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 6px 0', color: '#f1f5f9' }}>
                                    {item.cliente || 'Consumidor'}
                                </h3>
                                
                                <div style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 12px 0', lineHeight: '1.5', display: 'flex', gap: '6px' }}>
                                    <span style={{ fontSize: '16px' }}>📍</span>
                                    <span>{item.endereco}</span>
                                </div>

                                {/* EXIBIÇÃO DO RECEBEDOR OU MOTIVO DA FALHA */}
                                {!isFalha ? (
                                    <div style={{ fontSize: '13px', color: '#cbd5e1', margin: '0 0 24px 0', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '8px' }}>
                                        <span>👤</span>
                                        <span style={{ fontWeight: 600 }}>{getNomeExibicao(item)}</span>
                                    </div>
                                ) : (
                                    item.motivo_nao_entrega && (
                                        <div style={{ background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)', marginBottom: '20px', fontSize: '13px', color: '#fca5a5' }}>
                                            <b>Motivo:</b> {item.motivo_nao_entrega}
                                        </div>
                                    )
                                )}

                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    background: 'rgba(0,0,0,0.2)',
                                    padding: '12px 16px',
                                    borderRadius: '12px',
                                    border: '1px solid rgba(255,255,255,0.03)'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>{dataExtenso}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Finalizado às</div>
                                        <div style={{ fontSize: '18px', fontWeight: 900, color: cor }}>{hora}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default HistoricoEntregas;
