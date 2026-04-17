import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/opennav/' : '/',
  server: {
    host: true, // expose on LAN so you can test on your phone
  },
});
