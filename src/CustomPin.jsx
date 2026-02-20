import L from 'leaflet';

// Gera um ícone SVG em forma de gota (pin) como string HTML para uso com L.divIcon
// color: string hex, number: string|number|null, status: string
export function createCustomPinIcon(color = '#2563eb', number = null, status = '') {
  try {
    const safeColor = (typeof color === 'string' && color.match(/^#?[0-9a-fA-F]{3,6}$/)) ? (color.startsWith('#') ? color : `#${color}`) : '#2563eb';
    const safeNumber = (number === null || typeof number === 'undefined' || number === '') ? '' : String(number);
    // SVG size ~28x38 as requested
    const svg = `
<svg xmlns='http://www.w3.org/2000/svg' width='28' height='38' viewBox='0 0 28 38' aria-hidden='true'>
  <defs>
    <filter id='ds' x='-50%' y='-50%' width='200%' height='200%'>
      <feDropShadow dx='0' dy='1.5' stdDeviation='1.5' flood-color='rgba(0,0,0,0.25)'/>
    </filter>
  </defs>
  <g filter='url(#ds)'>
    <path d='M14 2 C8 2 3.5 7 3.5 13 C3.5 20 14 34 14 34 C14 34 24.5 20 24.5 13 C24.5 7 20 2 14 2 Z' fill='${safeColor}' />
  </g>
  ${safeNumber ? `<text x='14' y='13.2' text-anchor='middle' font-size='12' font-weight='800' fill='#ffffff' stroke='#000000' stroke-width='1' paint-order='stroke' font-family='Arial' alignment-baseline='middle'>${safeNumber}</text>` : ''}
</svg>`;

    const html = `
      <div style="width:60px;height:80px;position:relative;display:block;pointer-events:auto;">
        <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);display:flex;align-items:flex-end;justify-content:center;">
          ${svg}
        </div>
      </div>`;
    // iconSize enlarged to match wrapper; anchor adjusted to bottom center so the tip is the coordinate
    return L.divIcon({ html, className: 'custom-pin-icon', iconSize: [60, 80], iconAnchor: [30, 80], popupAnchor: [0, -34] });
  } catch (e) {
    // fallback: simple small circle with number
    try {
      const fallback = `
        <div style="width:60px;height:80px;position:relative;display:block;pointer-events:auto;">
          <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);display:flex;align-items:flex-end;justify-content:center;">
            <div style="width:28px;height:28px;border-radius:50%;background:#2563eb;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px">${number || ''}</div>
          </div>
        </div>`;
      // enlarge fallback hitbox similarly and anchor to bottom center
      return L.divIcon({ html: fallback, className: 'custom-pin-fallback', iconSize: [60, 80], iconAnchor: [30, 80], popupAnchor: [0, -28] });
    } catch (ee) {
      return L.divIcon();
    }
  }
}

export default createCustomPinIcon;
