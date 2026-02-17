import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

export default function AdvancedMarker({ map, position, onClick, children }) {
    const advRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!map || typeof window === 'undefined' || !window.google || !window.google.maps || !window.google.maps.marker) return;
        containerRef.current = document.createElement('div');
        containerRef.current.style.display = 'inline-block';
        containerRef.current.style.transform = 'translate(-50%, -100%)';

        const adv = new window.google.maps.marker.AdvancedMarkerElement({ map, position, element: containerRef.current });
        if (onClick) adv.addListener('click', onClick);
        advRef.current = adv;

        return () => {
            try {
                if (advRef.current) {
                    advRef.current.map = null;
                    advRef.current.element && advRef.current.element.remove();
                }
            } catch (e) { }
        };
        // position object identity should trigger effect when lat/lng change
    }, [map, position && position.lat, position && position.lng]);

    if (!containerRef.current) return null;
    return ReactDOM.createPortal(children, containerRef.current);
}
