import { useState } from 'react';

// Google Maps disabled: always return not loaded and no error.
export default function useGoogleMapsLoader() {
    const [loaded] = useState(false);
    const [error] = useState(null);
    return { loaded, error };
}
