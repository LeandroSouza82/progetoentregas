import React, { useEffect, useState } from 'react';
import MapaLogistica from './MapaLogistica';
import { supabase, buscarTodasEntregas, subscribeToTable, HAS_SUPABASE_CREDENTIALS } from './supabaseClient';

export default function DriverApp() {
	const [entregas, setEntregas] = useState([]);
	const [frota, setFrota] = useState([]);

	// Fetch initial data
	useEffect(() => {
		let mounted = true;

		const fetchAll = async () => {
			try {
				// prefer helper for entregas if available
				let entregasData = [];
				try {
					if (typeof buscarTodasEntregas === 'function') {
						entregasData = await buscarTodasEntregas();
					} else if (supabase && supabase.from) {
						const r = await supabase.from('entregas').select('*');
						entregasData = r && r.data ? r.data : [];
					}
				} catch (e) { entregasData = []; }

				let frotaData = [];
				try {
					if (supabase && supabase.from) {
						const r2 = await supabase.from('motoristas').select('*');
						frotaData = r2 && r2.data ? r2.data : [];
					}
				} catch (e) { frotaData = []; }

				if (!mounted) return;
				setEntregas(entregasData);
				setFrota(frotaData);
			} catch (e) {
				console.warn('DriverApp: falha ao buscar dados iniciais', e);
			}
		};

		fetchAll();

		return () => { mounted = false; };
	}, []);

	// Subscribe to realtime updates (fallback to polling implemented in supabaseClient)
	useEffect(() => {
		const subs = [];
		try {
			if (typeof subscribeToTable === 'function') {
				const unsubEnt = subscribeToTable('entregas', ({ data }) => { if (Array.isArray(data)) setEntregas(data); });
				const unsubFrota = subscribeToTable('motoristas', ({ data }) => { if (Array.isArray(data)) setFrota(data); });
				if (typeof unsubEnt === 'function') subs.push(unsubEnt);
				if (typeof unsubFrota === 'function') subs.push(unsubFrota);
			}
		} catch (e) { /* ignore */ }

		return () => { subs.forEach(s => { try { s(); } catch (e) { } }); };
	}, []);

	return (
		<div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
			<header style={{ padding: '12px 18px', background: '#111827', color: '#fff' }}>
				<h2 style={{ margin: 0, fontSize: '16px' }}>Driver App — Mapa</h2>
			</header>
			<main style={{ flex: 1 }}>
				<MapaLogistica entregas={entregas} frota={frota} height={600} mobile={false} />
			</main>
		</div>
	);
}
