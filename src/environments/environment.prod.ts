export const environment = {
  production: true,
  googleMapsApiKey: 'AIzaSyAoKRkNejxYTtwv92SX5RQX6qR6b9NwJh8',
  cartoBasemapsKey: 'cb1_414m_1_7c28b29902d8ee9818004aec',
  apiUrl: 'https://dreamcleaningnyc.com/api',
  googleClientId: '529008120720-inire1vjeivem8s8830ntrkpbmq1n3fd.apps.googleusercontent.com',
  stripePublishableKey: 'pk_live_51PYF6Z05IY2xZyNcvMKAtKn18jBqk61fq1TyWa7lZfZUnaCEftF2vNtZMBDhQKM1IiRmbhvLnrrCFhBS7NzgMWj000Hz7P7Mv2',
  useCookieAuth: true,
  // Where SERVER-SIDE renders send API calls (server-url.interceptor.ts, server.ts, the transfer-cache
  // origin map in app.config.server.ts). Production: the backend on the VPS loopback -
  // never the public domain (Cloudflare loopback trap).
  ssrApiOrigin: 'http://localhost:5000',
  appleClientId: 'com.dreamcleaningnearme.service',
  appleRedirectUri: 'https://dreamcleaningnyc.com/api/auth/apple-callback',
  googleMergeCallbackUrl: 'https://dreamcleaningnyc.com/api/auth/google-merge-callback'
};