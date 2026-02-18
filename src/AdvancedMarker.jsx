import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

// Simplified AdvancedMarker: neutral implementation without Google APIs.
// Creates a container and portals children into it. Does not interact with any Google Maps objects.
export default function AdvancedMarker({ map, position, onClick, children }) {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current) containerRef.current = document.createElement('div');
        containerRef.current.style.display = 'inline-block';
        containerRef.current.style.transform = 'translate(-50%, -100%)';
        return () => {
            try { containerRef.current && containerRef.current.remove(); } catch (e) { }
        };
    }, []);

    if (!containerRef.current) return null;
    return ReactDOM.createPortal(children, containerRef.current);
}
