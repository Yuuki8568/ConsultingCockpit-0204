import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests/blackbox', workers:1, retries:0,
 reporter:[['list'],['html',{open:'never'}]], use:{baseURL:'http://localhost:4420'},
 webServer:{command:'bun tests/fixture-server.ts',url:'http://localhost:4420/api/health',reuseExistingServer:false,timeout:60000}
});
