import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnvironment, PRODUCTION_PROJECT_REF } from '../src/environment.js';
const ref = 'homologacaoficticia';
const jwt = (project = ref, role = 'anon') => `header.${Buffer.from(JSON.stringify({ref: project, role})).toString('base64url')}.signature`;
const config = (overrides = {}) => ({
    VITE_APP_ENV: 'test', VITE_SUPABASE_PROJECT_REF: ref,
    VITE_SUPABASE_URL: `https://${ref}.supabase.co`, VITE_SUPABASE_ANON_KEY: jwt(), ...overrides,
});
test('missing configuration blocks instead of falling back to production', () => {
    assert.throws(() => resolveEnvironment({}));
    for (const field of ['VITE_SUPABASE_PROJECT_REF','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY']) {
        assert.throws(() => resolveEnvironment(config({[field]: ''})));
    }
});
test('test environment rejects the production project, including omitted environment', () => {
    for (const name of ['test', undefined]) assert.throws(() => resolveEnvironment(config({
        VITE_APP_ENV: name, VITE_SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF,
        VITE_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`, VITE_SUPABASE_ANON_KEY: jwt(PRODUCTION_PROJECT_REF),
    })), /produção/);
});
test('accepts only matching projects, HTTPS and public keys', () => {
    assert.equal(resolveEnvironment(config()).isTest, true);
    assert.equal(resolveEnvironment(config({VITE_SUPABASE_ANON_KEY: 'sb_publishable_fake'})).projectRef, ref);
    for (const key of [jwt('other'), jwt(ref,'service_role'), 'sb_secret_fake', 'invalid']) {
        assert.throws(() => resolveEnvironment(config({VITE_SUPABASE_ANON_KEY:key})));
    }
    for (const url of [`http://${ref}.supabase.co`, `https://${ref}.supabase.co.evil.test`, `https://user@${ref}.supabase.co`, `https://${ref}.supabase.co/path`, `https://${ref}.supabase.co?x=1`]) {
        assert.throws(() => resolveEnvironment(config({VITE_SUPABASE_URL:url})));
    }
});
test('production requires explicit environment and the known project', () => {
    assert.throws(() => resolveEnvironment(config({VITE_APP_ENV:'production'})));
    assert.throws(() => resolveEnvironment(config({VITE_APP_ENV:'staging'})));
    assert.equal(resolveEnvironment(config({VITE_APP_ENV:'production', VITE_SUPABASE_PROJECT_REF:PRODUCTION_PROJECT_REF,
        VITE_SUPABASE_URL:`https://${PRODUCTION_PROJECT_REF}.supabase.co`, VITE_SUPABASE_ANON_KEY:jwt(PRODUCTION_PROJECT_REF)})).isTest, false);
});
