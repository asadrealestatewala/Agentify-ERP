// Owner-supplied marketing assets and links. Leave a value empty until the real thing exists: empty values hide the
// related element instead of showing anything made up.

// Customer or partner logos you have written permission to display. Example:
//   { name: 'Harbour Realty', src: '/marketing/logos/harbour-realty.svg', width: 140, height: 32 }
export const APPROVED_LOGOS = [];

// Native app store listings, once published. Set at build time:
//   VITE_ANDROID_STORE_URL=https://play.google.com/store/apps/details?id=...
//   VITE_IOS_STORE_URL=https://apps.apple.com/app/...
// Only https links on play.google.com / apps.apple.com are shown.
export const STORE_LINKS = {
  android: import.meta.env.VITE_ANDROID_STORE_URL || '',
  ios: import.meta.env.VITE_IOS_STORE_URL || '',
};
