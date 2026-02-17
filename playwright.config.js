// @ts-check
import { devices } from '@playwright/test';

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
    timeout: 30_000,
    use: {
        baseURL: process.env.BASE_URL || 'http://localhost:5177',
        headless: true,
        viewport: { width: 1280, height: 800 }
    },
    testDir: 'tests/e2e'
};

export default config;
