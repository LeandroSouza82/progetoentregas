import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { supabase } from './supabaseClient';
import 'leaflet/dist/leaflet.css';

export default function App() {
    const [entregas, setEntregas] = useState([]);
    const [motoPos, setMotoPos] = useState({ lat: -27.595, lng: -48.548 }); // Posição inicial (Ex: Floripa)

    const fetchEntregas = async () => {
        const { data, error } = await supabase
            .from('entregas')
            .select('*')
            .order('ordem_logistica', { ascending: true });
        if (!error) setEntregas(data);
    };

    useEffect(() => { fetchEntregas(); }, []);

    const calcularDistancia = (pA, pB) =>
        Math.sqrt(Math.pow(pB.lat - pA.lat, 2) + Math.pow(pB.lng - pA.lng, 2));

    const sincronizarERoteirizar = async () => {
        let pendentes = entregas.filter(d => d.id !== 349 && d.status !== 'concluido');
        let pontoReferencia = motoPos;
        let novaSequencia = [];

        while (pendentes.length > 0) {
            let maisProximoIdx = 0;
            let menorDist = calcularDistancia(pontoReferencia, pendentes[0]);

            for (let i = 1; i < pendentes.length; i++) {
                const d = calcularDistancia(pontoReferencia, pendentes[i]);
                if (d < menorDist) {
                    menorDist = d;
                    maisProximoIdx = i;
                }
            }

            const proximo = pendentes.splice(maisProximoIdx, 1)[0];
            novaSequencia.push(proximo);
            pontoReferencia = { lat: proximo.lat, lng: proximo.lng };
        }

        for (let i = 0; i < novaSequencia.length; i++) {
            const ordemInt = parseInt(i + 1, 10); // 🔧 CONVERSÃO ESTRITA PARA INT4
            console.log(`💡 Tentando gravar int4:`, typeof ordemInt, ordemInt, '- ID:', novaSequencia[i].id);
            await supabase.from('entregas').update({ ordem_logistica: ordemInt }).eq('id', novaSequencia[i].id);
            console.log('✅ Ordem salva no banco:', ordemInt, '- ID:', novaSequencia[i].id);
        }
        console.log('✅ Reorganização finalizada! Atualizando pinos do mapa...');
        fetchEntregas();
    };

    const limparRotas = async () => {
        await supabase.from('entregas').update({ ordem_logistica: null }).neq('id', 349);
        fetchEntregas();
    };

    return (
        <div style={{ display: 'flex', height: '100vh', background: '#071228' }}>
            <div className="sidebar" style={{ width: '300px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <button className="glow-blue">Históricos</button>
                <button className="glow-yellow" onClick={sincronizarERoteirizar}>Sincronizar/Reorganizar</button>
                <button className="glow-green" onClick={fetchEntregas}>✔️ Check Rotas</button>
                <button className="glow-red" onClick={limparRotas}>🚫 Limpar</button>
            </div>

            <MapContainer center={motoPos} zoom={13} style={{ flex: 1 }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {entregas.map(entrega => (
                    <Marker
                        key={entrega.id}
                        position={[entrega.lat, entrega.lng]}
                    // Lógica de cores baseada no status e proteção ao ID 349
                    >
                        <Popup>{entrega.cliente} - {entrega.ordem_logistica || 'S/O'}</Popup>
                    </Marker>
                ))}
            </MapContainer>

            <style>{`
        .glow-blue { box-shadow: 0 0 10px #2563eb; background: #2563eb; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; }
        .glow-yellow { box-shadow: 0 0 10px #f59e0b; background: #f59e0b; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; }
        .glow-green { box-shadow: 0 0 15px #10b981; background: #10b981; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; animation: pulse-green 2s infinite; }
        .glow-red { box-shadow: 0 0 10px #ef4444; background: #ef4444; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; }
        @keyframes pulse-green { 0% { box-shadow: 0 0 5px #10b981; } 50% { box-shadow: 0 0 20px #10b981; } 100% { box-shadow: 0 0 5px #10b981; } }
      `}</style>
        </div>
    );
}
