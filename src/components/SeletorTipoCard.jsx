import React, { useEffect, useRef, useState } from 'react';

const OPCOES_TIPO = ['Entrega', 'Recolha', 'Outros'];

/**
 * Badge de tipo clicável usado nos cards da Fila de Preparação.
 * Ao clicar, abre um pequeno menu para alternar entre Entrega / Recolha / Outros.
 */
export default function SeletorTipoCard({ tipo, getColorForType, getContrastText, onAlterarTipo }) {
    const [aberto, setAberto] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const containerRef = useRef(null);

    const corAtual = getColorForType(tipo);
    const contrasteAtual = getContrastText(corAtual);

    useEffect(() => {
        if (!aberto) return undefined;
        const fecharAoClicarFora = (ev) => {
            if (containerRef.current && !containerRef.current.contains(ev.target)) setAberto(false);
        };
        const fecharComEsc = (ev) => { if (ev.key === 'Escape') setAberto(false); };
        document.addEventListener('mousedown', fecharAoClicarFora);
        document.addEventListener('keydown', fecharComEsc);
        return () => {
            document.removeEventListener('mousedown', fecharAoClicarFora);
            document.removeEventListener('keydown', fecharComEsc);
        };
    }, [aberto]);

    const selecionar = async (novoTipo) => {
        setAberto(false);
        if (String(novoTipo).toLowerCase() === String(tipo || '').toLowerCase()) return;
        setSalvando(true);
        try {
            await onAlterarTipo(novoTipo);
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
                type="button"
                title="Clique para alterar o tipo"
                disabled={salvando}
                onClick={() => setAberto(a => !a)}
                style={{
                    fontSize: '12px',
                    padding: '6px 10px',
                    borderRadius: '12px',
                    background: corAtual,
                    color: contrasteAtual,
                    fontWeight: 700,
                    border: 'none',
                    cursor: salvando ? 'wait' : 'pointer',
                    opacity: salvando ? 0.6 : 1,
                    lineHeight: 1.2
                }}
            >
                {salvando ? '...' : tipo} ▾
            </button>

            {aberto && (
                <div
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        minWidth: '140px',
                        background: '#0f172a',
                        border: '1px solid rgba(148, 163, 184, 0.25)',
                        borderRadius: '10px',
                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                        padding: '6px',
                        zIndex: 1300
                    }}
                >
                    {OPCOES_TIPO.map(opcao => {
                        const cor = getColorForType(opcao);
                        const ativo = String(opcao).toLowerCase() === String(tipo || '').toLowerCase();
                        return (
                            <button
                                key={opcao}
                                type="button"
                                onClick={() => selecionar(opcao)}
                                onMouseEnter={(ev) => { ev.currentTarget.style.background = 'rgba(59, 130, 246, 0.18)'; }}
                                onMouseLeave={(ev) => { ev.currentTarget.style.background = ativo ? 'rgba(255, 255, 255, 0.06)' : 'transparent'; }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    width: '100%',
                                    padding: '8px 10px',
                                    background: ativo ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                                    border: 'none',
                                    borderRadius: '6px',
                                    color: '#e2e8f0',
                                    fontSize: '13px',
                                    fontWeight: ativo ? 800 : 600,
                                    cursor: 'pointer',
                                    textAlign: 'left'
                                }}
                            >
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                                {opcao}
                                {ativo && <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
