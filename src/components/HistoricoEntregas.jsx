import React from 'react';

const HistoricoEntregas = ({ isOpen, onClose, entregas = [], theme = {} }) => {
    // Fallback para o tema caso não seja passado corretamente
    const safeTheme = {
        card: theme?.card || '#111827',
        primary: theme?.primary || '#3b82f6',
        textMain: theme?.textMain || '#ffffff',
        textLight: theme?.textLight || '#9ca3af',
        danger: theme?.danger || '#ef4444',
        accent: theme?.accent || '#60a5fa'
    };

    // Ordenar entregas por criado_em descendente (mais recentes primeiro)
    const entregasOrdenadas = React.useMemo(() => {
        return [...entregas].sort((a, b) => {
            const dateA = new Date(a.created_at || a.criado_em || 0);
            const dateB = new Date(b.created_at || b.criado_em || 0);
            return dateB - dateA;
        });
    }, [entregas]);

    // Função para copiar detalhes da entrega formatados para WhatsApp
    const copiarDetalhes = (entrega) => {
        const status = String(entrega.status || '').toLowerCase();
        const tipo = entrega.tipo || 'Entrega';
        const cliente = entrega.cliente || `ID #${entrega.id}`;
        const endereco = entrega.endereco || 'Não informado';
        const horario = entrega.horario_conclusao || '';
        const recebedor = entrega.recebedor || '';
        const lat = entrega.lat_conclusao || '';
        const lng = entrega.lng_conclusao || '';
        const obs = entrega.observacoes || entrega.obs || entrega.motivo_nao_entrega || '';

        let texto = `*RELATÓRIO DE ATIVIDADE - ADECELL*\n\n`;
        texto += `*Tipo:* ${tipo}\n`;
        texto += `*Cliente:* ${cliente}\n`;
        texto += `*Endereço:* ${endereco}\n`;
        texto += `*Status:* ${status.toUpperCase()}\n`;

        if (horario) texto += `*Horário:* ${horario}\n`;
        if (recebedor) texto += `*Recebedor:* ${recebedor}\n`;
        if (lat && lng) texto += `*Localização:* https://www.google.com/maps?q=${lat},${lng}\n`;
        if (obs) texto += `*Obs:* ${obs}\n`;

        navigator.clipboard.writeText(texto).then(() => {
            alert('✅ Relatório copiado para o WhatsApp!');
        }).catch(err => {
            console.error('Erro ao copiar:', err);
            alert('❌ Erro ao copiar. Tente novamente.');
        });
    };

    // Helper para definir cor do status
    const getStatusColor = (status) => {
        const s = String(status || '').toLowerCase();
        if (s === 'entregue' || s === 'concluido') return '#10b981';
        if (s === 'falha') return '#ef4444';
        if (s === 'em_rota') return '#3b82f6';
        return '#f59e0b'; // pendente
    };

    // Helper para definir cor do tipo de serviço seguindo a coluna 'tipo'
    const getTypeColor = (tipo) => {
        const t = String(tipo || '').toLowerCase();
        if (t === 'entrega') return '#3498db'; // Azul Entrega
        if (t === 'recolha' || t === 'releta') return '#f39c12'; // Laranja Recolha
        return '#d8b4fe'; // Lilás (Outros tipos)
    };

    const getStatusLabel = (status) => {
        const s = String(status || '').toLowerCase();
        return s === 'em_rota' ? 'EM ROTA' : s.toUpperCase();
    };

    return (
        <>
            {/* Backdrop com blur */}
            {isOpen && (
                <div
                    onClick={onClose}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        background: 'rgba(0, 0, 0, 0.4)',
                        backdropFilter: 'blur(5px)',
                        zIndex: 1399,
                        transition: 'all 0.4s ease'
                    }}
                />
            )}

            {/* Drawer deslizante */}
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    width: '500px',
                    height: '100vh',
                    background: safeTheme.card,
                    boxShadow: isOpen ? '-4px 0 30px rgba(0, 0, 0, 0.6)' : 'none',
                    transition: 'transform 0.4s ease, box-shadow 0.4s ease',
                    transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
                    zIndex: 1400,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '30px 25px',
                    visibility: isOpen ? 'visible' : 'hidden'
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', paddingBottom: '15px', borderBottom: `2px solid ${safeTheme.primary}` }}>
                    <h2 style={{ margin: 0, color: safeTheme.textMain, fontSize: '22px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        📋 Histórico de Atividades
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: `2px solid ${safeTheme.danger}`,
                            color: safeTheme.danger,
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            fontWeight: '700',
                            transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = safeTheme.danger;
                            e.currentTarget.style.color = '#fff';
                            e.currentTarget.style.transform = 'rotate(90deg)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = safeTheme.danger;
                            e.currentTarget.style.transform = 'rotate(0deg)';
                        }}
                        title="Fechar"
                    >
                        ✕
                    </button>
                </div>

                {/* Contador */}
                <div style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ fontSize: '13px', color: safeTheme.textLight, fontWeight: '600' }}>
                        Atividades Registradas: <span style={{ color: safeTheme.primary, fontSize: '18px', fontWeight: '800' }}>{entregasOrdenadas.length}</span>
                    </div>
                </div>

                {/* Lista de cards com scroll estilizado */}
                <div
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        paddingRight: '10px',
                        scrollbarWidth: 'thin',
                        scrollbarColor: `${safeTheme.primary} rgba(255,255,255,0.05)`
                    }}
                    className="custom-scrollbar"
                >
                    {entregasOrdenadas.length === 0 ? (
                        <div style={{ textAlign: 'center', color: safeTheme.textLight, padding: '60px 20px', fontSize: '15px' }}>
                            📭 Nenhuma atividade registrada ainda.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {entregasOrdenadas.map((entrega, idx) => {
                                const status = String(entrega.status || '').toLowerCase();
                                const tipoServico = entrega.tipo || 'Entrega';
                                const typeColor = getTypeColor(tipoServico);
                                const statusColor = getStatusColor(status);
                                const statusLabel = getStatusLabel(status);
                                const detalheExtra = entrega.observacoes || entrega.obs || entrega.motivo_nao_entrega || '';
                                const isEntregue = ['entregue', 'concluido'].includes(status);

                                return (
                                    <div
                                        key={entrega.id || idx}
                                        style={{
                                            background: 'rgba(255, 255, 255, 0.03)',
                                            border: '1px solid rgba(255, 255, 255, 0.08)',
                                            borderLeft: `5px solid ${typeColor}`,
                                            borderRadius: '12px',
                                            padding: '16px',
                                            transition: 'all 0.3s ease',
                                            position: 'relative',
                                            overflow: 'hidden'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                            e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.3), 0 0 10px ${typeColor}20`;
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                            e.currentTarget.style.boxShadow = 'none';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                                        }}
                                    >
                                        {/* Badge de Tipo no Topo Esquerdo */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: '800',
                                                    textTransform: 'uppercase',
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    background: typeColor,
                                                    color: '#fff'
                                                }}>
                                                    {tipoServico}
                                                </span>
                                                {isEntregue && (
                                                    <span style={{ color: '#10b981', fontSize: '14px' }} title="Concluído">✅</span>
                                                )}
                                            </div>

                                            <span style={{ fontSize: '11px', color: safeTheme.textLight, opacity: 0.7 }}>
                                                #{entrega.id}
                                            </span>
                                        </div>

                                        {/* Informações Principais */}
                                        <div style={{ marginBottom: '12px' }}>
                                            <div style={{ color: safeTheme.textMain, fontWeight: '700', fontSize: '16px', marginBottom: '4px' }}>
                                                {entrega.cliente || 'Cliente não identificado'}
                                            </div>
                                            <div style={{ fontSize: '12px', color: safeTheme.textLight, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ display: 'flex', gap: '5px', alignItems: 'flex-start' }}>
                                                    <span>📍</span>
                                                    <span>{entrega.endereco || 'Endereço não informado'}</span>
                                                </div>
                                                {(entrega.horario_conclusao || entrega.recebedor || entrega.lat_conclusao) && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px', fontSize: '11px', color: safeTheme.primary }}>
                                                        {entrega.horario_conclusao && <span>🕒 {entrega.horario_conclusao}</span>}
                                                        {entrega.recebedor && <span>👤 {entrega.recebedor}</span>}
                                                        {entrega.lat_conclusao && (
                                                            <span style={{ color: '#10b981', fontWeight: 'bold' }}>📍 Local Validado</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Status e Botão Copiar */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                                            <div style={{
                                                flex: 1,
                                                padding: '8px 12px',
                                                borderRadius: '8px',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                                background: `${statusColor}15`,
                                                color: statusColor,
                                                border: `1px solid ${statusColor}30`,
                                                textAlign: 'center'
                                            }}>
                                                {statusLabel}
                                            </div>

                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    copiarDetalhes(entrega);
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    color: safeTheme.textMain,
                                                    border: '1px solid rgba(255,255,255,0.1)',
                                                    borderRadius: '8px',
                                                    fontSize: '14px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s ease',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background = safeTheme.primary;
                                                    e.currentTarget.style.color = '#fff';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                                    e.currentTarget.style.color = safeTheme.textMain;
                                                }}
                                                title="Copiar Detalhes"
                                            >
                                                📋
                                            </button>
                                        </div>

                                        {/* Detalhes extras (obs ou motivo) */}
                                        {detalheExtra && (
                                            <div style={{
                                                fontSize: '11px',
                                                color: status === 'falha' ? '#ef4444' : safeTheme.textLight,
                                                background: status === 'falha' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.02)',
                                                padding: '10px',
                                                borderRadius: '8px',
                                                marginTop: '12px',
                                                border: `1px solid ${status === 'falha' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.05)'}`,
                                                fontStyle: 'italic'
                                            }}>
                                                💬 {detalheExtra}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer com info */}
                <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', color: safeTheme.textLight, textAlign: 'center' }}>
                    💡 Clique no ícone 📋 para copiar os detalhes da atividade
                </div>
            </div>

            {/* CSS para scrollbar customizada */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 8px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: ${safeTheme.primary};
                    border-radius: 10px;
                    transition: all 0.3s ease;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: ${safeTheme.accent};
                }
            `}</style>
        </>
    );
};

export default HistoricoEntregas;
