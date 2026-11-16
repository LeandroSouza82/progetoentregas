import React from 'react';

const estiloLink = {
    display: 'block',
    padding: '12px',
    borderRadius: '12px',
    color: '#fff',
    textAlign: 'center',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: 700
};

function temCoordenadas(lat, lng) {
    return Math.abs(Number(lat)) > 0 && Math.abs(Number(lat)) <= 90 &&
        Math.abs(Number(lng)) > 0 && Math.abs(Number(lng)) <= 180;
}

const waze = (lat, lng) => `https://waze.com/ul?ll=${Number(lat)},${Number(lng)}&navigate=yes`;

export default function NavegacaoEntrega({ entrega }) {
    const { lat, lng, lat_coleta, lng_coleta } = entrega;
    const destinoLocalizado = temCoordenadas(lat, lng);
    return (
        <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
            {destinoLocalizado ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <a href={waze(lat, lng)} target="_blank" rel="noopener noreferrer" style={{ ...estiloLink, background: '#2563eb' }}>Waze · Entrega</a>
                    <a
                        href={`https://www.openstreetmap.org/?mlat=${Number(lat)}&mlon=${Number(lng)}#map=18/${Number(lat)}/${Number(lng)}`}
                        target="_blank" rel="noopener noreferrer" style={{ ...estiloLink, background: '#15803d' }}
                    >
                        Mapa · Entrega
                    </a>
                </div>
            ) : <p style={{ margin: 0 }}>Localização da entrega pendente.</p>}
            {temCoordenadas(lat_coleta, lng_coleta) && (
                <a href={waze(lat_coleta, lng_coleta)} target="_blank" rel="noopener noreferrer" style={{ ...estiloLink, background: '#475569' }}>
                    Abrir coleta no Waze
                </a>
            )}
        </div>
    );
}
