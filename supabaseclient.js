const { createClient } = require('@supabase/supabase-js');

function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey =
        process.env.SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
        const error = new Error(
            'Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.'
        );
        error.statusCode = 503;
        throw error;
    }

    return { url, publishableKey };
}

function createAuthClient() {
    const { url, publishableKey } = getSupabaseConfig();

    return createClient(url, publishableKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
}

function createServiceClient() {
    const { url } = getSupabaseConfig();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
        const error = new Error(
            'Server-side Supabase access is not configured. Set SUPABASE_SERVICE_ROLE_KEY.'
        );
        error.statusCode = 503;
        throw error;
    }

    return createClient(url, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
}

module.exports = { createAuthClient, createServiceClient };
