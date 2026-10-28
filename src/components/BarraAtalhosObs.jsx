import React, { useState, useRef, useEffect } from 'react';

const OPCOES_OUTROS = [
    'Malote',
    'Pasta de Prestação de Contas',
    'Ata de Assembleia',
    'Notificações / Advertências',
    'Cheques para Assinatura',
    'Contrato / Documentos para Assinar',
    'Chaves / Controle / Tag',
    'Encomenda / Correios',
    'Material de Limpeza / Manutenção'
];

const MESES = [
    { num: '01', nome: 'Jan' },
    { num: '02', nome: 'Fev' },
    { num: '03', nome: 'Mar' },
    { num: '04', nome: 'Abr' },
    { num: '05', nome: 'Mai' },
    { num: '06', nome: 'Jun' },
    { num: '07', nome: 'Jul' },
    { num: '08', nome: 'Ago' },
    { num: '09', nome: 'Set' },
    { num: '10', nome: 'Out' },
    { num: '11', nome: 'Nov' },
    { num: '12', nome: 'Dez' }
];

export default function BarraAtalhosObs({ setObservacoesGestor }) {
    const [menuAberto, setMenuAberto] = useState(null); // 'balancete' | 'outros' | null
    const [anoSelecionado, setAnoSelecionado] = useState(() => new Date().getFullYear());
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickFora = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setMenuAberto(null);
            }
        };
        document.addEventListener('mousedown', handleClickFora);
        return () => document.removeEventListener('mousedown', handleClickFora);
    }, []);

    const inserirObservacao = (texto) => {
        if (!texto || typeof setObservacoesGestor !== 'function') return;
        setObservacoesGestor((prev) => {
            const atual = String(prev || '').trim();
            return atual ? `${atual}, ${texto}` : texto;
        });
        setMenuAberto(null);
    };

    const handleSelecionarDataCalendario = (e) => {
        const valor = e.target.value; // YYYY-MM-DD
        if (!valor) return;
        const partes = valor.split('-');
        if (partes.length === 3) {
            const dataFormatada = `${partes[2]}/${partes[1]}/${partes[0]}`;
            inserirObservacao(`Balancete - ${dataFormatada}`);
        }
    };

    const handleSelecionarMesAno = (mesNum) => {
        inserirObservacao(`Balancete - ${mesNum}/${anoSelecionado}`);
    };

    const getBotaoStyle = (ativo) => ({
        width: '100%',
        padding: '9px 12px',
        borderRadius: '8px',
        border: ativo ? '1px solid #60a5fa' : '1px solid rgba(255, 255, 255, 0.1)',
        background: ativo ? 'rgba(59, 130, 246, 0.18)' : 'rgba(15, 23, 42, 0.75)',
        color: ativo ? '#60a5fa' : '#cbd5e1',
        fontSize: '13px',
        fontWeight: 700,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        transition: 'all 0.18s ease',
        boxSizing: 'border-box'
    });

    const popoverBaseStyle = {
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        background: '#0f172a',
        border: '1px solid rgba(96, 165, 250, 0.3)',
        borderRadius: '12px',
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.65)',
        zIndex: 1250,
        padding: '12px',
        color: '#f8fafc',
        boxSizing: 'border-box'
    };

    return (
        <div
            ref={containerRef}
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '10px',
                marginTop: '-6px',
                marginBottom: '2px',
                position: 'relative',
                width: '100%'
            }}
        >
            {/* 1. Botão da Esquerda: Balancete */}
            <div style={{ position: 'relative' }}>
                <button
                    type="button"
                    onClick={() => setMenuAberto((prev) => (prev === 'balancete' ? null : 'balancete'))}
                    style={getBotaoStyle(menuAberto === 'balancete')}
                    onMouseEnter={(e) => {
                        if (menuAberto !== 'balancete') {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.color = '#ffffff';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (menuAberto !== 'balancete') {
                            e.currentTarget.style.background = 'rgba(15, 23, 42, 0.75)';
                            e.currentTarget.style.color = '#cbd5e1';
                        }
                    }}
                >
                    <span>📅</span> Balancete
                </button>

                {menuAberto === 'balancete' && (
                    <div style={{ ...popoverBaseStyle, left: 0, width: '250px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>
                            Selecionar Data (DD/MM/AAAA)
                        </div>
                        <input
                            type="date"
                            onChange={handleSelecionarDataCalendario}
                            style={{
                                width: '100%',
                                padding: '7px 10px',
                                borderRadius: '8px',
                                border: '1px solid #334155',
                                background: '#1e293b',
                                color: '#f8fafc',
                                fontSize: '13px',
                                fontWeight: 600,
                                outline: 'none',
                                marginBottom: '12px',
                                boxSizing: 'border-box',
                                cursor: 'pointer'
                            }}
                        />

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                                Ou Mês / Ano
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                    type="button"
                                    onClick={() => setAnoSelecionado((a) => a - 1)}
                                    style={{ background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', borderRadius: '4px', padding: '1px 6px', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}
                                >
                                    ‹
                                </button>
                                <span style={{ fontSize: '12px', fontWeight: 800, color: '#60a5fa' }}>{anoSelecionado}</span>
                                <button
                                    type="button"
                                    onClick={() => setAnoSelecionado((a) => a + 1)}
                                    style={{ background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', borderRadius: '4px', padding: '1px 6px', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}
                                >
                                    ›
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
                            {MESES.map((m) => (
                                <button
                                    key={m.num}
                                    type="button"
                                    onClick={() => handleSelecionarMesAno(m.num)}
                                    style={{
                                        padding: '5px 4px',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255, 255, 255, 0.08)',
                                        background: '#1e293b',
                                        color: '#e2e8f0',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        transition: '0.15s'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = '#3b82f6';
                                        e.currentTarget.style.color = '#ffffff';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = '#1e293b';
                                        e.currentTarget.style.color = '#e2e8f0';
                                    }}
                                >
                                    {m.nome}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* 2. Botão do Meio: Boletos (Ação direta com 1 clique) */}
            <div>
                <button
                    type="button"
                    onClick={() => inserirObservacao('Boletos')}
                    style={getBotaoStyle(false)}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                        e.currentTarget.style.color = '#ffffff';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(15, 23, 42, 0.75)';
                        e.currentTarget.style.color = '#cbd5e1';
                    }}
                >
                    <span>📄</span> Boletos
                </button>
            </div>

            {/* 3. Botão da Direita: Outros */}
            <div style={{ position: 'relative' }}>
                <button
                    type="button"
                    onClick={() => setMenuAberto((prev) => (prev === 'outros' ? null : 'outros'))}
                    style={getBotaoStyle(menuAberto === 'outros')}
                    onMouseEnter={(e) => {
                        if (menuAberto !== 'outros') {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.color = '#ffffff';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (menuAberto !== 'outros') {
                            e.currentTarget.style.background = 'rgba(15, 23, 42, 0.75)';
                            e.currentTarget.style.color = '#cbd5e1';
                        }
                    }}
                >
                    <span>📦</span> Outros
                </button>

                {menuAberto === 'outros' && (
                    <div
                        style={{
                            ...popoverBaseStyle,
                            right: 0,
                            width: '260px',
                            padding: '6px',
                            maxHeight: '280px',
                            overflowY: 'auto'
                        }}
                    >
                        {OPCOES_OUTROS.map((opcao, idx) => (
                            <button
                                key={opcao}
                                type="button"
                                onClick={() => inserirObservacao(opcao)}
                                style={{
                                    width: '100%',
                                    textAlign: 'left',
                                    padding: '8px 10px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    borderBottom: idx < OPCOES_OUTROS.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
                                    background: 'transparent',
                                    color: '#e2e8f0',
                                    fontSize: '12.5px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'block',
                                    transition: 'background 0.15s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                                    e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.color = '#e2e8f0';
                                }}
                            >
                                {opcao}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

