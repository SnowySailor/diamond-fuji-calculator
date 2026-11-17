// Same loading approach as seichi.moe's scene review tool: a script tag with
// loading=async + callback, plus gm_authFailure for rejected keys.

declare global {
  interface Window {
    gm_authFailure?: () => void;
    __onGoogleMapsLoaded?: () => void;
  }
}

let loading: Promise<void> | null = null;
const authListeners = new Set<() => void>();

export function onMapsAuthFailure(cb: () => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export function loadGoogleMaps(apiKey: string | undefined): Promise<void> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set in .env.local. Add it and restart the container.'));
      return;
    }
    window.gm_authFailure = () => authListeners.forEach((cb) => cb());
    window.__onGoogleMapsLoaded = () => resolve();
    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=marker,elevation&loading=async&callback=__onGoogleMapsLoaded`;
    script.async = true;
    script.addEventListener('error', () => reject(new Error('Could not load Google Maps.')));
    document.head.append(script);
  });
  return loading;
}
