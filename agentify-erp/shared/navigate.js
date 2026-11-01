// "Navigate" links: open the phone's or computer's own maps app with a destination. They need no key and no account.
// Google Maps directions work everywhere (the Android app and the web); Apple Maps is offered first on Apple devices.
export const validPoint = (lat, lng) => {
  const a = Number(lat); const b = Number(lng);
  return lat !== '' && lng !== '' && lat != null && lng != null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
};

/** True for iPhone, iPad (including iPadOS, which reports itself as a Mac with a touch screen) and Mac. */
export const isApplePlatform = (nav = typeof navigator !== 'undefined' ? navigator : {}) =>
  /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(String(nav.userAgent || '')) || nav.platform === 'MacIntel';

/** { google, apple, primary: 'google' | 'apple' } for a destination, or null when the coordinates are not usable. */
export function navLinks(lat, lng, { label = '', nav } = {}) {
  if (!validPoint(lat, lng)) return null;
  const a = Number(lat).toFixed(6); const b = Number(lng).toFixed(6);
  const name = String(label || '').trim().slice(0, 80);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${a},${b}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${a},${b}&dirflg=d${name ? `&q=${encodeURIComponent(name)}` : ''}`,
    primary: isApplePlatform(nav) ? 'apple' : 'google',
  };
}
