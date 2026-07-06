import React from 'react';

const HistoricoCard = ({ item, theme }) => {
    // ── AUDITORIA DO PAYLOAD PARA CORREÇÃO ──
    console.log("Item do Histórico:", item);

    // ── TRAVA INTELIGENTE: reclassifica status baseado em palavras-chave ──
    const PALAVRAS_FALHA = ['fechado', 'não localizado', 'nao localizado', 'ausente', 'recusou', 'risco', 'outro motivo', 'mudou', 'desconhecido', 'não atende', 'nao atende', 'endereço errado', 'endereco errado'];

    const definirStatusReal = (i) => {
        const statusOriginal = String(i.status || '').toLowerCase();
        if (statusOriginal === 'falha' || statusOriginal === 'erro') return 'falha';
        
        const campos = [
            i.motivo_nao_entrega, i.tipo_recebedor, i.obs, i.recebedor
        ].map(c => String(c || '').toLowerCase()).join(' ');

        for (const palavra of PALAVRAS_FALHA) {
            if (campos.includes(palavra)) return 'falha';
        }

        return statusOriginal;
    };

    const getCardColor = (i) => {
        if (definirStatusReal(i) === 'falha') return '#ef4444';

        const t = String(i.tipo || '').toLowerCase();
        if (t.includes('recolha')) return '#F59E0B';
        if (t.includes('serviço') || t.includes('outro') || t.includes('coleta')) return '#8B5CF6';
        return '#3B82F6';
    };

    const formatarDataDetalhada = (dataString) => {
        if (!dataString) return { hora: '--:--', dataExtenso: 'Data indisponível', diaMes: '--/--' };
        try {
            const data = new Date(dataString);
            
            const diaSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(data);
            const diaMesExtenso = new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(data);
            const nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(data);
            const horaLocal = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(data);
            
            const diaSemanaCap = diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1);
            const nomeMesCap = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);

            return {
                hora: horaLocal,
                dataExtenso: `${diaSemanaCap}, ${diaMesExtenso} de ${nomeMesCap}`,
                diaMes: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(data),
                diaSemana: diaSemanaCap
            };
        } catch (e) {
            return { hora: '--:--', dataExtenso: 'Erro na data', diaMes: '--/--' };
        }
    };

    const validarTexto = (txt) => {
        if (txt === null || txt === undefined) return null;
        if (typeof txt !== 'string' && typeof txt !== 'number') return null; // Prevenindo objetos ou arrays
        const val = String(txt).trim();
        return (val !== "" && val.toLowerCase() !== "null" && val.toLowerCase() !== "undefined") ? val : null;
    };

    const getMotivoFinal = (i) => {
        const tecnico = validarTexto(i.motivo_nao_entrega);
        const deslocado = validarTexto(i.tipo_recebedor); 
        const manual = validarTexto(i.obs);

        if (tecnico && (tecnico.toLowerCase() === "outro motivo" || tecnico.toLowerCase() === "outros")) {
            return manual || deslocado || tecnico;
        }

        return tecnico || deslocado || manual || "Não informado";
    };

    const titleCase = (str) => {
        if (!str) return '';
        return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
    };

    const isFalha = definirStatusReal(item) === 'falha';
    const cor = getCardColor(item);
    const { hora, dataExtenso } = formatarDataDetalhada(item.data_conclusao || item.created_at);
    const conteudoSolicitado = validarTexto(item.aviso_gestor) || validarTexto(item.observacoes_gestor) || validarTexto(item.obs);

    const copiarComprovante = () => {
        const statusStr = isFalha ? 'FALHA' : 'ENTREGA CONCLUÍDA';
        
        const rawVinculo = validarTexto(item.tipo_recebedor) || validarTexto(item.recebedor_tipo);
        
        let rawNome = validarTexto(item.recebedor) || validarTexto(item.nome_recebedor) || validarTexto(item.recebedor_nome);
        if (!rawNome && rawVinculo && validarTexto(item.observacoes) && validarTexto(item.observacoes).toLowerCase() !== 'nenhuma') {
            rawNome = validarTexto(item.observacoes);
        }
        
        const nomeRecebedor = isFalha ? getMotivoFinal(item) : (rawNome ? titleCase(rawNome) : 'Nome não informado');
        const vinculo = isFalha ? '' : (rawVinculo ? rawVinculo : '');
        
        const refAbreviada = String(item.id).slice(-6).toUpperCase();

        let texto = `*COMPROVANTE DE ENTREGA V10 DELIVERY* 📦\n\n`;
        texto += `🔹 *REF:* ${refAbreviada}\n`;
        texto += `🔹 *CLIENTE:* ${item.cliente || 'Consumidor'}\n`;
        texto += `🔹 *ENDEREÇO:* ${item.endereco}\n`;
        if (conteudoSolicitado) {
            texto += `🔹 *CONTEÚDO/SERVIÇO:* ${conteudoSolicitado}\n`;
        }
        texto += `\n-----------------------------------------\n`;
        texto += `✅ *STATUS:* ${statusStr}\n`;
        if (!isFalha) {
            texto += `👤 *RECEBIDO POR:* ${nomeRecebedor} ${vinculo ? `(${vinculo.toUpperCase()})` : ''}\n`;
        } else {
            texto += `👤 *RECEBIDO POR:* ${nomeRecebedor}\n`;
        }
        texto += `⏰ *HORÁRIO:* ${hora}\n`;
        texto += `📅 *DATA:* ${dataExtenso}\n\n`;
        texto += `_Os arquivos de foto e assinatura digital encontram-se arquivados em nosso servidor sob auditoria._`;

        navigator.clipboard.writeText(texto);
        alert('Copiado para a área de transferência!');
    };

    return (
        <div style={{
            background: theme.card,
            border: isFalha ? `2px solid #ef4444` : `1px solid rgba(255,255,255,0.03)`,
            borderRadius: '20px',
            padding: '24px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: isFalha ? '0 0 20px rgba(239,68,68,0.15)' : '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
            transition: 'all 0.2s ease',
            minWidth: '340px'
        }}>
            <div style={{ 
                position: 'absolute', 
                top: 0, 
                left: 0, 
                width: '6px', 
                height: '100%', 
                background: cor 
            }} />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                        {item.tipo || 'Entrega'}
                    </div>
                    
                    {isFalha && (
                        <div style={{ 
                            padding: '4px 8px', 
                            borderRadius: '6px', 
                            background: '#ef4444', 
                            color: '#fff',
                            fontSize: '10px',
                            fontWeight: 900,
                            textTransform: 'uppercase',
                            boxShadow: '0 2px 8px rgba(239,68,68,0.3)'
                        }}>
                            FALHA
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#475569', fontWeight: 700 }}>
                        REF: {String(item.id).slice(-6).toUpperCase()}
                    </span>
                    <button 
                        onClick={copiarComprovante}
                        title="Copiar Comprovante"
                        style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, transition: '0.2s' }}
                        onMouseOver={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseOut={(e) => e.target.style.background = 'rgba(255,255,255,0.05)'}
                    >
                        📋 COPIAR
                    </button>
                </div>
            </div>

            <h3 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 6px 0', color: '#f1f5f9' }}>
                {item.cliente || 'Consumidor'}
            </h3>
            
            <div style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 12px 0', lineHeight: '1.5', display: 'flex', gap: '6px' }}>
                <span style={{ fontSize: '16px' }}>📍</span>
                <span>{item.endereco}</span>
            </div>

            {/* CONTEÚDO SOLICITADO / OBSERVAÇÕES DO GESTOR */}
            {conteudoSolicitado && (
                <div style={{ background: `${cor}15`, border: `1px solid ${cor}30`, borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: cor, marginBottom: '6px', textTransform: 'uppercase' }}>
                        📦 O QUE FOI SOLICITADO:
                    </div>
                    <div style={{ fontSize: '14px', color: '#f1f5f9', fontWeight: 600, lineHeight: '1.4' }}>
                        {conteudoSolicitado}
                    </div>
                </div>
            )}

            {/* O POD / MOTIVO DE FALHA */}
            {!isFalha ? (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '12px', borderRadius: '10px', marginBottom: '20px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#34d399', marginBottom: '6px', textTransform: 'uppercase' }}>
                        🤝 COMPROVANTE (POD)
                    </div>
                    <div style={{ fontSize: '14px', color: '#e2e8f0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '16px' }}>👤</span>
                        <span>
                            {(() => {
                                let n = validarTexto(item.recebedor) || validarTexto(item.nome_recebedor) || validarTexto(item.recebedor_nome);
                                const v = validarTexto(item.tipo_recebedor) || validarTexto(item.recebedor_tipo);
                                if (!n && v && validarTexto(item.observacoes) && validarTexto(item.observacoes).toLowerCase() !== 'nenhuma') {
                                    n = validarTexto(item.observacoes);
                                }
                                return n ? titleCase(n) : 'Nome não informado';
                            })()}
                        </span>
                        
                        {(validarTexto(item.tipo_recebedor) || validarTexto(item.recebedor_tipo)) && (
                            <span style={{ background: '#059669', color: '#fff', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', padding: '3px 8px', borderRadius: '4px', letterSpacing: '0.5px' }}>
                                {validarTexto(item.tipo_recebedor) || validarTexto(item.recebedor_tipo)}
                            </span>
                        )}
                    </div>
                </div>
            ) : (
                <div style={{ background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)', marginBottom: '20px', fontSize: '13px', color: '#fca5a5' }}>
                    <b>Motivo:</b> {getMotivoFinal(item)}
                </div>
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
                    
                    {/* MÍDIAS */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        {item.foto_url && (
                            <button 
                                style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '4px 8px', fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: '0.2s' }} 
                                onClick={() => window.open(item.foto_url, '_blank')}
                                onMouseOver={(e) => e.target.style.color = '#fff'}
                                onMouseOut={(e) => e.target.style.color = '#94a3b8'}
                            >
                                📷 FOTO
                            </button>
                        )}
                        {item.assinatura_url && (
                            <button 
                                style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '4px 8px', fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: '0.2s' }} 
                                onClick={() => window.open(item.assinatura_url, '_blank')}
                                onMouseOver={(e) => e.target.style.color = '#fff'}
                                onMouseOut={(e) => e.target.style.color = '#94a3b8'}
                            >
                                ✍️ ASSINATURA
                            </button>
                        )}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Finalizado às</div>
                    <div style={{ fontSize: '18px', fontWeight: 900, color: cor }}>{hora}</div>
                </div>
            </div>
        </div>
    );
};

export default HistoricoCard;
