export const environment = {
    production: false,
    googleMapsApiKey: 'AIzaSyAoKRkNejxYTtwv92SX5RQX6qR6b9NwJh8',
    cartoBasemapsKey: 'cb1_414m_1_7c28b29902d8ee9818004aec',
    // Use relative URL so Angular dev-server proxy (`proxy.conf.json`) can forward to the local API.
    // This avoids CORS/credentials issues and mirrors production behavior more closely.
    apiUrl: '/api',
    googleClientId: '529008120720-inire1vjeivem8s8830ntrkpbmq1n3fd.apps.googleusercontent.com',
    stripePublishableKey: 'pk_test_51Rj2zA09XH2Z4IpCi9EV0vc5OOx59FLoGW1a9HNy59OrwadL5amuD70JFi6TbH2OwkPSZ27Wvh5DnUJILFHpSmzL00y0ou7fDM',
    // Local dev uses token-based auth (cookie auth typically requires HTTPS due to Secure cookies).
    useCookieAuth: false,
    // Where SERVER-SIDE renders send API calls (server-url.interceptor.ts, server.ts, the transfer-cache
    // origin map in app.config.server.ts). ng serve: the local backend - keep it
    // in step with the /api target in proxy.conf.json.
    ssrApiOrigin: 'http://localhost:5107',
  appleClientId: 'com.dreamcleaningnearme.service',
  appleRedirectUri: 'http://localhost:5107/api/auth/apple-callback',
  googleMergeCallbackUrl: 'http://localhost:4200/api/auth/google-merge-callback'
};