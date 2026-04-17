import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // expose on LAN so you can test on your phone
  },
});
