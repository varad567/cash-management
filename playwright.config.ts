import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./e2e', timeout:30000, workers:1, reporter:'list',
 use:{baseURL:'http://127.0.0.1:4173',headless:true,channel:'msedge',serviceWorkers:'block'},
 webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort',url:'http://127.0.0.1:4173',reuseExistingServer:false,
   env:{VITE_SUPABASE_URL:'https://cash-test.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'},timeout:30000},
});
