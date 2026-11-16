import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import createCustomPinIcon from '../CustomPin.jsx';
import { coordenadasNaRegiaoDeEntregas } from '../geoUtils.js';

const icone = createCustomPinIcon();
const centroPadrao = [-27.645, -48.648];

function SelecaoNoMapa({ referencia, onSelecionar }) {
    const mapa = useMap();
    useEffect(() => {
        const frame = requestAnimationFrame(() => mapa.invalidateSize());
        return () => cancelAnimationFrame(frame);
    }, [mapa]);
    useMapEvents({ click: ({ latlng }) => onSelecionar(latlng) });
    useEffect(() => {
        if (referencia) mapa.setView([referencia.lat, referencia.lng], 18);
    }, [mapa, referencia]);
    return null;
}

export default function LocalizacaoEntrega({ entrega, onBuscar, onSalvar, onFechar, theme }) {
    const dialog = useRef(null);
    const temPonto = coordenadasNaRegiaoDeEntregas(entrega.lat, entrega.lng);
    const [ponto, setPonto] = useState(null);
    const [referencia, setReferencia] = useState(null);
    const [buscando, setBuscando] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState('');
    const pontoVisivel = ponto || referencia || (temPonto ? entrega : null);

    useEffect(() => {
        dialog.current.showModal();
    }, []);

    async function buscar() {
        setBuscando(true);
        setMensagem('');
        try {
            const resultado = await onBuscar(entrega.endereco);
            setReferencia(resultado);
            setPonto(resultado && !resultado.aproximado ? resultado : null);
            if (resultado?.aproximado) setMensagem('Rua localizada. Marque no mapa a entrada do imóvel.');
            if (!resultado) setMensagem('Imóvel não localizado na busca. Você pode marcar a entrada no mapa.');
        } catch {
            setMensagem('A busca falhou. Tente novamente ou marque a entrada no mapa.');
        } finally {
            setBuscando(false);
        }
    }

    async function salvar() {
        setSalvando(true);
        setMensagem('');
        try {
            await onSalvar(entrega, ponto);
            onFechar();
        } catch (error) {
            setMensagem(error.message || 'Não foi possível salvar a localização.');
        } finally {
            setSalvando(false);
        }
    }

    function selecionar(posicao) {
        if (buscando || salvando) return;
        if (!coordenadasNaRegiaoDeEntregas(posicao.lat, posicao.lng)) {
            setMensagem('Selecione um ponto dentro da região de atendimento.');
            return;
        }
        setPonto({ lat: posicao.lat, lng: posicao.lng });
        setMensagem('');
    }

    return (
        <dialog
            ref={dialog}
            aria-labelledby="titulo-localizacao-entrega"
            onCancel={event => {
                event.preventDefault();
                if (!salvando) onFechar();
            }}
            style={{ width: 'min(680px, 92vw)', maxHeight: '92dvh', boxSizing: 'border-box', border: 0, borderRadius: 12, padding: 20, background: theme.card, color: theme.textMain }}
        >
            <h2 id="titulo-localizacao-entrega" style={{ margin: '0 0 8px' }}>Localização da entrega</h2>
            <p>{entrega.endereco}</p>
            <p>Clique no mapa para marcar a entrada do imóvel.</p>
            <MapContainer
                center={temPonto ? [entrega.lat, entrega.lng] : centroPadrao}
                zoom={temPonto ? 18 : 13}
                style={{ height: 'min(44dvh, 390px)', borderRadius: 8 }}
            >
                <TileLayer
                    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    maxZoom={19}
                />
                <SelecaoNoMapa referencia={referencia} onSelecionar={selecionar} />
                {pontoVisivel && <Marker position={[pontoVisivel.lat, pontoVisivel.lng]} icon={icone} title={referencia?.aproximado && !ponto ? 'Referência da rua' : 'Localização da entrega'} />}
            </MapContainer>
            <p role="status" style={{ minHeight: '1.2em' }}>{mensagem}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" disabled={salvando} onClick={onFechar}>Cancelar</button>
                <button type="button" disabled={buscando || salvando} onClick={buscar}>{buscando ? 'Buscando…' : 'Buscar endereço'}</button>
                <button type="button" disabled={!ponto || buscando || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar ponto'}</button>
            </div>
        </dialog>
    );
}
