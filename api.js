const express = require('express');
const crypto = require('node:crypto');
const { createAuthClient, createServiceClient } = require('./supabaseclient');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const restaurantStageStatuses = ['Pending', 'Approved', 'Cooking'];
const orderStatuses = [
    'Pending',
    'Approved',
    'Cooking',
    'Out for Delivery',
    'Delivered'
];

function apiError(message, statusCode = 500) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireBody(condition, message) {
    if (!condition) {
        throw apiError(message, 400);
    }
}

function isHttpUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function validMenu(items) {
    return Array.isArray(items) &&
        items.length <= 500 &&
        items.every(item =>
            item &&
            Number.isSafeInteger(item.id) &&
            item.id > 0 &&
            typeof item.name === 'string' &&
            item.name.trim().length > 0 &&
            item.name.length <= 100 &&
            typeof item.category === 'string' &&
            item.category.trim().length > 0 &&
            item.category.length <= 60 &&
            Number.isFinite(item.price) &&
            item.price > 0 &&
            isHttpUrl(item.image) &&
            (item.description === undefined || typeof item.description === 'string')
        );
}

function validPosters(posters) {
    return Array.isArray(posters) &&
        posters.length <= 100 &&
        posters.every(poster =>
            poster &&
            Number.isSafeInteger(poster.id) &&
            poster.id > 0 &&
            typeof poster.title === 'string' &&
            poster.title.trim().length > 0 &&
            poster.title.length <= 100 &&
            isHttpUrl(poster.image)
        );
}

function validLocation(location) {
    if (location === undefined || location === null) {
        return true;
    }

    return location &&
        Number.isFinite(location.latitude) &&
        location.latitude >= -90 &&
        location.latitude <= 90 &&
        Number.isFinite(location.longitude) &&
        location.longitude >= -180 &&
        location.longitude <= 180 &&
        Number.isFinite(location.accuracy) &&
        location.accuracy > 0 &&
        location.accuracy <= 100000 &&
        typeof location.capturedAt === 'string' &&
        Number.isFinite(Date.parse(location.capturedAt));
}

function validOrder(order) {
    return order &&
        typeof order.name === 'string' &&
        order.name.trim().length > 0 &&
        order.name.length <= 100 &&
        typeof order.phone === 'string' &&
        /^[0-9+ -]{7,20}$/.test(order.phone) &&
        typeof order.address === 'string' &&
        order.address.trim().length > 0 &&
        order.address.length <= 500 &&
        ['upi', 'cod'].includes(order.paymentMethod) &&
        validOrderItems(order.items) &&
        validLocation(order.location);
}

function validOrderItems(items) {
    return Array.isArray(items) &&
        items.length > 0 &&
        items.length <= 50 &&
        items.every(item =>
            item &&
            Number.isSafeInteger(item.menuItemId) &&
            item.menuItemId > 0 &&
            Number.isInteger(item.qty) &&
            item.qty > 0 &&
            item.qty <= 100
        ) &&
        new Set(items.map(item => item.menuItemId)).size === items.length;
}

function calculateCancellation(order) {
    if (restaurantStageStatuses.includes(order.status)) {
        return {
            stage: 'restaurant',
            policy: 'restaurant_stage_full_refund',
            paidAmount: Number(order.paid_amount),
            foodMakingDeduction: 0,
            deliveryDeduction: 0,
            refundAmount: Number(order.paid_amount)
        };
    }

    if (order.status === 'Out for Delivery') {
        const foodSubtotalCents = Math.round(Number(order.food_subtotal) * 100);
        const foodMakingDeduction = Math.floor((foodSubtotalCents + 5) / 10) / 100;
        const deliveryDeduction = Number(order.delivery_charge);
        const refundAmount = Math.max(roundedMoney(
            Number(order.paid_amount) - foodMakingDeduction - deliveryDeduction
        ), 0);
        return {
            stage: 'delivery',
            policy: 'delivery_stage_deductions',
            paidAmount: Number(order.paid_amount),
            foodMakingDeduction,
            deliveryDeduction,
            refundAmount
        };
    }

    throw apiError(
        order.status === 'Delivered'
            ? 'Delivered orders cannot be cancelled.'
            : 'This order cannot be cancelled at its current status.',
        409
    );
}

function razorpayCredentials() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = razorpayKeySecret();
    if (!keyId || !keySecret) {
        throw apiError('Razorpay is not configured on the server.', 503);
    }
    return { keyId, keySecret };
}

function razorpayKeySecret() {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
        throw apiError('Razorpay is not configured on the server.', 503);
    }
    return keySecret;
}

async function razorpayRequest(endpoint, { method = 'GET', body } = {}) {
    const { keyId, keySecret } = razorpayCredentials();
    const response = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
        method,
        headers: {
            Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = result.error?.description || 'Razorpay could not complete the request.';
        throw apiError(message, response.status >= 500 ? 502 : 400);
    }
    return result;
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
    const keySecret = razorpayKeySecret();
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
        return false;
    }
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest();
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function canonicalItems(items) {
    return [...items]
        .sort((left, right) => left.menuItemId - right.menuItemId)
        .map(item => ({ menuItemId: item.menuItemId, qty: item.qty }));
}

function itemsHash(items) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(canonicalItems(items)))
        .digest('hex');
}

async function getOrderAmount(supabase, items) {
    const ids = items.map(item => item.menuItemId);
    const [menuResult, settingsResult] = await Promise.all([
        supabase.from('menu_items')
            .select('id, price')
            .in('id', ids)
            .eq('is_available', true),
        supabase.from('restaurant_settings')
            .select('delivery_fee, tax_rate')
            .eq('id', 'default')
            .single()
    ]);
    if (menuResult.error || settingsResult.error || !settingsResult.data) {
        throw apiError('Could not verify the current order prices.', 503);
    }

    const menuById = new Map((menuResult.data || []).map(item => [Number(item.id), Number(item.price)]));
    if (menuById.size !== ids.length || ids.some(id => !menuById.has(id))) {
        throw apiError('One or more menu items are no longer available.', 409);
    }

    const subtotalCents = items.reduce((sum, item) =>
        sum + BigInt(Math.round(menuById.get(item.menuItemId) * 100)) * BigInt(item.qty), 0n);
    const taxBasisPoints = BigInt(Math.round(Number(settingsResult.data.tax_rate) * 10000));
    const deliveryCents = BigInt(Math.round(Number(settingsResult.data.delivery_fee) * 100));
    const totalRupees = (
        subtotalCents * (10000n + taxBasisPoints) +
        deliveryCents * 10000n +
        500000n
    ) / 1000000n;
    return Number(totalRupees);
}

function refundStatusFromGateway(status) {
    if (status === 'processed') return 'processed';
    if (status === 'failed') return 'failed';
    if (status === 'pending' || status === 'created') return 'processing';
    throw apiError('Razorpay returned an unknown refund status.', 502);
}

async function submitRazorpayRefund(order) {
    const amount = Math.round(Number(order.refund_amount) * 100);
    const refunds = await razorpayRequest(
        `/payments/${encodeURIComponent(order.razorpay_payment_id)}/refunds?count=100`
    );
    let refund = (refunds.items || []).find(item =>
        item.notes?.order_id === order.id && Number(item.amount) === amount
    );
    if (!refund) {
        refund = await razorpayRequest(
            `/payments/${encodeURIComponent(order.razorpay_payment_id)}/refund`,
            {
                method: 'POST',
                body: { amount, notes: { order_id: order.id } }
            }
        );
    }
    if (!refund?.id) {
        throw apiError('Razorpay did not return a refund ID.', 502);
    }
    return {
        id: refund.id,
        status: refundStatusFromGateway(refund.status)
    };
}

function roundedMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function saveGatewayRefundStatus(supabase, order, refund) {
    const { data, error } = await supabase
        .from('orders')
        .update({
            razorpay_refund_id: refund.id,
            refund_status: refund.status
        })
        .eq('id', order.id)
        .select('*, order_items(*)')
        .maybeSingle();
    if (error || !data) {
        console.error('Razorpay refund was created but its status could not be saved:', {
            orderId: order.id,
            refundId: refund.id,
            message: error?.message || 'Order was not found.'
        });
        throw apiError('Refund was submitted but its status could not be saved. Contact the restaurant.', 500);
    }
    return toOrder(data);
}

function bearerToken(req) {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : '';
}

async function getVerifiedUser(token) {
    if (!token) {
        throw apiError('Sign in is required.', 401);
    }

    const { data, error } = await createAuthClient().auth.getUser(token);

    if (error || !data.user) {
        throw apiError('Your session is invalid or expired. Please sign in again.', 401);
    }

    return data.user;
}

async function getProfile(supabase, userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, role')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        throw apiError('Could not verify the account role.', 500);
    }

    return data;
}

async function authorizeRole(req, role) {
    const user = await getVerifiedUser(bearerToken(req));
    const profile = await getProfile(createServiceClient(), user.id);

    if (!profile || profile.role !== role) {
        throw apiError('You are not authorized to perform this action.', 403);
    }

    req.authUser = user;
    req.profile = profile;
}

function toMenuItem(row) {
    return {
        id: Number(row.id),
        name: row.name,
        category: row.category,
        price: Number(row.price),
        image: row.image_url,
        description: row.description
    };
}

function toPoster(row) {
    return {
        id: Number(row.id),
        title: row.title,
        description: row.description,
        category: row.category,
        image: row.image_url,
        is_published: row.is_published,
        expires_at: row.expires_at,
        button_label: row.button_label,
        button_url: row.button_url
    };
}

function toOrder(row) {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        phone: row.phone,
        type: row.order_type,
        total: Number(row.total),
        paymentMethod: row.payment_method,
        payment: row.payment_method.toUpperCase(),
        paymentStatus: row.payment_status,
        paidAmount: Number(row.paid_amount),
        status: row.status,
        foodSubtotal: row.food_subtotal === null ? null : Number(row.food_subtotal),
        deliveryCharge: row.delivery_charge === null ? null : Number(row.delivery_charge),
        cancellationReason: row.cancellation_reason,
        cancelledAt: row.cancelled_at,
        cancellationPolicy: row.cancellation_policy,
        foodMakingDeduction: row.food_making_deduction === null ? null : Number(row.food_making_deduction),
        deliveryDeduction: row.delivery_deduction === null ? null : Number(row.delivery_deduction),
        refundAmount: row.refund_amount === null ? null : Number(row.refund_amount),
        refundStatus: row.refund_status,
        razorpayRefundId: row.razorpay_refund_id,
        address: row.address,
        latitude: row.location_latitude ?? null,
        longitude: row.location_longitude ?? null,
        locationAccuracy: row.location_accuracy_m ?? null,
        locationCapturedAt: row.location_captured_at ?? null,
        createdAt: row.created_at,
        items: (row.order_items || []).map(item => ({
            name: item.item_name,
            qty: item.quantity,
            price: Number(item.unit_price)
        }))
    };
}

async function loadOrders(supabase, query = supabase.from('orders').select('*, order_items(*)')) {
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
        throw apiError('Could not load orders.', 500);
    }

    return (data || []).map(toOrder);
}

function createApiApp() {
    const app = express();
    app.disable('x-powered-by');
    app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), asyncRoute(async (req, res) => {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const signature = req.get('x-razorpay-signature') || '';
        if (!webhookSecret) {
            throw apiError('Razorpay webhook verification is not configured.', 503);
        }
        if (!Buffer.isBuffer(req.body) || !/^[a-f0-9]{64}$/i.test(signature)) {
            throw apiError('Invalid Razorpay webhook request.', 400);
        }
        const expected = crypto.createHmac('sha256', webhookSecret).update(req.body).digest();
        const received = Buffer.from(signature, 'hex');
        if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
            throw apiError('Razorpay webhook signature is invalid.', 401);
        }

        const event = JSON.parse(req.body.toString('utf8'));
        const refund = event.payload?.refund?.entity;
        if (refund?.id && ['refund.created', 'refund.processed', 'refund.failed'].includes(event.event)) {
            const supabase = createServiceClient();
            const { data: order, error: lookupError } = await supabase
                .from('orders')
                .select('id, refund_amount')
                .eq('razorpay_refund_id', refund.id)
                .eq('razorpay_payment_id', refund.payment_id)
                .maybeSingle();
            if (lookupError) {
                throw apiError('Could not verify the Razorpay refund update.', 500);
            }
            if (order && Number(refund.amount) !== Math.round(Number(order.refund_amount) * 100)) {
                throw apiError('Razorpay refund amount does not match the saved order refund.', 409);
            }
            const refundStatus = event.event === 'refund.processed'
                ? 'processed'
                : event.event === 'refund.failed'
                    ? 'failed'
                    : 'processing';
            const { error } = order
                ? await supabase
                    .from('orders')
                    .update({ refund_status: refundStatus })
                    .eq('id', order.id)
                : { error: null };
            if (error) {
                throw apiError('Could not save the Razorpay refund update.', 500);
            }
        }
        res.json({ received: true });
    }));
    app.use(express.json({ limit: '20kb' }));

    app.get('/api/health', (req, res) => {
        res.json({ ok: true });
    });

    app.get('/api/public-data', asyncRoute(async (req, res) => {
        const supabase = createAuthClient();
        const [menuResult, posterResult, settingsResult] = await Promise.all([
            supabase.from('menu_items')
                .select('id, name, category, price, image_url, description')
                .eq('is_available', true)
                .order('id'),
            supabase.from('posters')
                .select('id, title, description, category, image_url, is_published, expires_at, button_label, button_url')
                .eq('is_published', true)
                .order('created_at', { ascending: false }),
            supabase.from('restaurant_settings')
                .select('id, restaurant_name, phone, email, address, opening_hours, delivery_fee, tax_rate')
                .eq('id', 'default')
                .maybeSingle()
        ]);

        const queryErrors = [
            ['menu_items', menuResult.error],
            ['posters', posterResult.error],
            ['restaurant_settings', settingsResult.error]
        ].filter(([, error]) => error).map(([table, error]) => ({
            table,
            code: error.code,
            message: error.message
        }));

        if (queryErrors.length > 0) {
            console.error('Supabase public data queries failed:', queryErrors);
            throw apiError('Could not load restaurant information from Supabase.', 503);
        }

        const today = new Date().toISOString().slice(0, 10);
        res.json({
            menu: (menuResult.data || []).map(toMenuItem),
            posters: (posterResult.data || [])
                .filter(poster => !poster.expires_at || poster.expires_at >= today)
                .map(toPoster),
            settings: settingsResult.data
        });
    }));

    app.post('/api/send-otp', asyncRoute(async (req, res) => {
        const email = String(req.body?.email || '').trim().toLowerCase();
        requireBody(emailPattern.test(email) && email.length <= 254, 'Enter a valid email address.');

        const { error } = await createAuthClient().auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true }
        });

        if (error) {
            console.error('Supabase OTP request failed:', error.message);
            throw apiError('Could not send the verification code. Check Supabase Auth email settings and try again.', 502);
        }

        res.json({ message: 'Verification code sent to your email.' });
    }));

    app.post('/api/verify-otp', asyncRoute(async (req, res) => {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const code = String(req.body?.code || '').trim();
        requireBody(emailPattern.test(email) && email.length <= 254, 'Enter a valid email address.');
        requireBody(/^\d{6}$/.test(code), 'Enter the 6-digit verification code.');

        const { data, error } = await createAuthClient().auth.verifyOtp({
            email,
            token: code,
            type: 'email'
        });

        if (error || !data.session || !data.user) {
            throw apiError('The verification code is invalid or expired. Request a new code.', 400);
        }

        res.json({
            verified: true,
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            user: { id: data.user.id, email: data.user.email }
        });
    }));

    app.post('/api/auth/refresh', asyncRoute(async (req, res) => {
        const refreshToken = typeof req.body?.refreshToken === 'string'
            ? req.body.refreshToken
            : '';
        requireBody(refreshToken.length > 0 && refreshToken.length <= 4096,
            'A valid refresh token is required.');

        const { data, error } = await createAuthClient().auth.refreshSession({
            refresh_token: refreshToken
        });

        if (error || !data.session) {
            throw apiError('Your session expired. Please sign in again.', 401);
        }

        res.json({
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token
        });
    }));

    app.post('/api/customer/register', asyncRoute(async (req, res) => {
        const { name, phone, email, password } = req.body || {};
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

        requireBody(
            normalizedName.length > 0 &&
            normalizedName.length <= 100 &&
            /^\d{10}$/.test(normalizedPhone) &&
            emailPattern.test(normalizedEmail) &&
            normalizedEmail.length <= 254 &&
            typeof password === 'string' &&
            password.length >= 8 &&
            password.length <= 128,
            'Enter valid details. Password must be at least 8 characters.'
        );

        const user = await getVerifiedUser(bearerToken(req));
        if ((user.email || '').toLowerCase() !== normalizedEmail) {
            throw apiError('Verify this email address before creating the account.', 403);
        }

        const supabase = createServiceClient();
        const profile = await getProfile(supabase, user.id);
        if (!profile || profile.role !== 'customer' || profile.phone) {
            throw apiError('This email is already registered. Please sign in.', 409);
        }

        const { data: existingPhone, error: phoneLookupError } = await supabase
            .from('profiles')
            .select('id')
            .eq('phone', normalizedPhone)
            .maybeSingle();

        if (phoneLookupError) {
            throw apiError('Could not verify the mobile number.', 500);
        }
        if (existingPhone && existingPhone.id !== user.id) {
            throw apiError('This mobile number is already registered. Please sign in.', 409);
        }

        const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
            password,
            user_metadata: { full_name: normalizedName, phone: normalizedPhone }
        });

        if (updateError) {
            console.error('Supabase customer account update failed:', updateError.message);
            throw apiError('Could not create the account. Please try again.', 500);
        }

        const { error: profileUpdateError } = await supabase
            .from('profiles')
            .update({
                full_name: normalizedName,
                phone: normalizedPhone,
                email: normalizedEmail,
                updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

        if (profileUpdateError) {
            console.error('Supabase customer profile update failed:', profileUpdateError.message);
            throw apiError('The account was created but its profile could not be saved. Please contact the restaurant.', 500);
        }

        res.status(201).json({
            success: true,
            message: 'Account created. You can now sign in.'
        });
    }));

    app.post('/api/customer/login', asyncRoute(async (req, res) => {
        const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
        const password = req.body?.password;
        requireBody(/^\d{10}$/.test(phone) && typeof password === 'string' && password.length <= 128,
            'Enter your registered mobile number and password.');

        const supabase = createServiceClient();
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, email, full_name, phone, role')
            .eq('phone', phone)
            .maybeSingle();

        if (profileError || !profile || profile.role !== 'customer') {
            throw apiError('Invalid mobile number or password.', 401);
        }

        const authClient = createAuthClient();
        const { data, error } = await authClient.auth.signInWithPassword({
            email: profile.email,
            password
        });

        if (error || !data.session) {
            throw apiError('Invalid mobile number or password.', 401);
        }

        res.json({
            success: true,
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            customer: {
                id: profile.id,
                name: profile.full_name,
                phone: profile.phone,
                email: profile.email
            }
        });
    }));

    app.post('/api/admin/login', asyncRoute(async (req, res) => {
        const email = typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase()
            : '';
        const password = req.body?.password;
        requireBody(emailPattern.test(email) && typeof password === 'string' && password.length <= 128,
            'Enter your administrator email and password.');

        const authClient = createAuthClient();
        const { data, error } = await authClient.auth.signInWithPassword({ email, password });
        if (error || !data.session || !data.user) {
            throw apiError('Invalid administrator email or password.', 401);
        }

        const profile = await getProfile(createServiceClient(), data.user.id);
        if (!profile || profile.role !== 'admin') {
            await authClient.auth.signOut();
            throw apiError('This account is not authorized as an administrator.', 403);
        }

        res.json({
            success: true,
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            administrator: { id: profile.id, email: profile.email }
        });
    }));

    const adminOnly = asyncRoute(async (req, res, next) => {
        await authorizeRole(req, 'admin');
        next();
    });

    const customerOnly = asyncRoute(async (req, res, next) => {
        await authorizeRole(req, 'customer');
        next();
    });

    app.post('/api/payments/razorpay/orders', customerOnly, asyncRoute(async (req, res) => {
        const items = req.body?.items;
        requireBody(validOrderItems(items), 'Order items are invalid.');
        const supabase = createServiceClient();
        const amountRupees = await getOrderAmount(supabase, items);
        const { keyId } = razorpayCredentials();
        const razorpayOrder = await razorpayRequest('/orders', {
            method: 'POST',
            body: {
                amount: amountRupees * 100,
                currency: 'INR',
                receipt: `sm-${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`,
                notes: {
                    user_id: req.authUser.id,
                    items_hash: itemsHash(items)
                }
            }
        });
        if (
            !razorpayOrder.id ||
            Number(razorpayOrder.amount) !== amountRupees * 100 ||
            razorpayOrder.currency !== 'INR'
        ) {
            throw apiError('Razorpay returned an invalid payment order.', 502);
        }
        res.status(201).json({
            keyId,
            razorpayOrderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency
        });
    }));

    app.post('/api/admin/verify', adminOnly, (req, res) => {
        res.json({ ok: true });
    });

    app.get('/api/admin/data', adminOnly, asyncRoute(async (req, res) => {
        const orders = await loadOrders(createServiceClient());
        res.json({ orders });
    }));

    app.put('/api/admin/menu', adminOnly, asyncRoute(async (req, res) => {
        const items = req.body?.items;
        requireBody(validMenu(items), 'Menu data is invalid.');

        const supabase = createServiceClient();
        const { error } = await supabase.rpc('replace_menu_items', { p_items: items });
        if (error) {
            console.error('Supabase menu update failed:', error.message);
            throw apiError('Could not save menu items.', 500);
        }

        const { data, error: selectError } = await supabase
            .from('menu_items')
            .select('id, name, category, price, image_url, description')
            .order('id');
        if (selectError) {
            throw apiError('Menu was saved but could not be reloaded.', 500);
        }

        res.json({ menu: (data || []).map(toMenuItem) });
    }));

    app.put('/api/admin/posters', adminOnly, asyncRoute(async (req, res) => {
        const posters = req.body?.posters;
        requireBody(validPosters(posters), 'Poster data is invalid.');

        const supabase = createServiceClient();
        const { error } = await supabase.rpc('replace_posters', { p_posters: posters });
        if (error) {
            console.error('Supabase poster update failed:', error.message);
            throw apiError('Could not save posters.', 500);
        }

        const { data, error: selectError } = await supabase
            .from('posters')
            .select('id, title, description, category, image_url, is_published, expires_at, button_label, button_url')
            .order('id');
        if (selectError) {
            throw apiError('Posters were saved but could not be reloaded.', 500);
        }

        res.json({ posters: (data || []).map(toPoster) });
    }));

    app.patch('/api/admin/orders/:id', adminOnly, asyncRoute(async (req, res) => {
        const status = req.body?.status;
        requireBody(orderStatuses.includes(status), 'Order status is invalid.');

        const { data, error } = await createServiceClient()
            .from('orders')
            .update({ status })
            .eq('id', req.params.id)
            .neq('status', 'Cancelled')
            .select('*, order_items(*)')
            .maybeSingle();

        if (error) {
            throw apiError('Could not update the order status.', 500);
        }
        if (!data) {
            throw apiError('Order was not found or has already been cancelled.', 404);
        }

        res.json({ order: toOrder(data) });
    }));

    app.get('/api/customer/orders/:id/cancellation-preview', customerOnly, asyncRoute(async (req, res) => {
        const { data: order, error } = await createServiceClient()
            .from('orders')
            .select('id, status, paid_amount, food_subtotal, delivery_charge')
            .eq('id', req.params.id)
            .eq('user_id', req.authUser.id)
            .maybeSingle();
        if (error) {
            throw apiError('Could not load cancellation details.', 500);
        }
        if (!order) {
            throw apiError('Order was not found.', 404);
        }
        if (order.food_subtotal === null || order.delivery_charge === null) {
            throw apiError("An exact cancellation calculation is unavailable from this order's saved payment and charge data. Contact the restaurant with the order ID for review.", 409);
        }
        res.json({
            orderId: order.id,
            status: order.status,
            ...calculateCancellation(order)
        });
    }));

    app.post('/api/customer/orders/:id/cancel', customerOnly, asyncRoute(async (req, res) => {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        const expectedStatus = req.body?.expectedStatus;
        requireBody(reason.length > 0 && reason.length <= 500, 'Enter a cancellation reason (up to 500 characters).');
        requireBody(
            [...restaurantStageStatuses, 'Out for Delivery'].includes(expectedStatus),
            'Cancellation status is invalid. Reload the cancellation calculation.'
        );
        const supabase = createServiceClient();
        const { data, error } = await supabase.rpc('cancel_customer_order', {
            p_user_id: req.authUser.id,
            p_order_id: req.params.id,
            p_reason: reason,
            p_expected_status: expectedStatus
        });
        if (error || !data) {
            const message = error?.message || 'Cancellation could not be completed.';
            if (error?.code === 'P0002' || message.includes('Order was not found')) {
                throw apiError('Order was not found.', 404);
            }
            if (
                message.includes('current status') ||
                message.includes('status changed')
            ) {
                throw apiError(message, 409);
            }
            if (message.includes('Saved charge details')) {
                throw apiError(
                    "An exact cancellation calculation is unavailable from this order's saved payment and charge data. Contact the restaurant with the order ID for review.",
                    409
                );
            }
            console.error('Supabase order cancellation failed:', message);
            throw apiError('Could not cancel this order. Please contact the restaurant.', 500);
        }

        let order = toOrder(data);
        let refundMessage = '';
        if (order.refundStatus === 'admin_requested' && data.razorpay_payment_id) {
            try {
                const gatewayRefund = await submitRazorpayRefund(data);
                order = await saveGatewayRefundStatus(supabase, data, gatewayRefund);
            } catch (refundError) {
                console.error('Automatic Razorpay refund submission failed:', {
                    orderId: order.id,
                    message: refundError.message
                });
                refundMessage = 'Cancellation was saved, but Razorpay could not confirm the refund submission. The refund is not marked processed; contact the restaurant with your order ID.';
            }
        }
        res.json({ order, refundMessage });
    }));

    app.post('/api/admin/orders/:id/refund/verify', adminOnly, asyncRoute(async (req, res) => {
        const refundId = typeof req.body?.refundId === 'string' ? req.body.refundId.trim() : '';
        requireBody(/^rfnd_[A-Za-z0-9]+$/.test(refundId), 'Enter a valid Razorpay refund ID.');
        const supabase = createServiceClient();
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, status, payment_method, razorpay_payment_id, refund_amount')
            .eq('id', req.params.id)
            .maybeSingle();
        if (orderError) {
            throw apiError('Could not load the order refund request.', 500);
        }
        if (!order) {
            throw apiError('Order was not found.', 404);
        }
        if (order.status !== 'Cancelled') {
            throw apiError('The order has not been cancelled.', 409);
        }
        if (order.payment_method !== 'upi' || !order.razorpay_payment_id || Number(order.refund_amount) <= 0) {
            throw apiError('This order has no Razorpay refund to verify.', 409);
        }
        const gatewayRefund = await razorpayRequest(
            `/payments/${encodeURIComponent(order.razorpay_payment_id)}/refunds/${encodeURIComponent(refundId)}`
        );
        if (
            gatewayRefund.id !== refundId ||
            gatewayRefund.payment_id !== order.razorpay_payment_id ||
            Number(gatewayRefund.amount) !== Math.round(Number(order.refund_amount) * 100)
        ) {
            throw apiError('The Razorpay refund does not match this order and refund amount.', 409);
        }
        const refundStatus = refundStatusFromGateway(gatewayRefund.status);
        const { data, error } = await supabase
            .from('orders')
            .update({ razorpay_refund_id: refundId, refund_status: refundStatus })
            .eq('id', req.params.id)
            .eq('status', 'Cancelled')
            .select('*, order_items(*)')
            .maybeSingle();
        if (error || !data) {
            throw apiError('Could not save the verified refund status.', 500);
        }
        res.json({ order: toOrder(data) });
    }));

    app.get('/api/customer/orders', customerOnly, asyncRoute(async (req, res) => {
        const supabase = createServiceClient();
        const orders = await loadOrders(
            supabase,
            supabase.from('orders')
                .select('*, order_items(*)')
                .eq('user_id', req.authUser.id)
        );
        res.json({ orders });
    }));

    app.post('/api/orders', asyncRoute(async (req, res) => {
        requireBody(validOrder(req.body), 'Order details are invalid.');
        await authorizeRole(req, 'customer');

        const supabase = createServiceClient();
        let paidAmount = 0;
        let razorpayOrderId = null;
        let razorpayPaymentId = null;
        if (req.body.paymentMethod === 'upi') {
            const payment = req.body.razorpayPayment || {};
            razorpayOrderId = typeof payment.orderId === 'string' ? payment.orderId : '';
            razorpayPaymentId = typeof payment.paymentId === 'string' ? payment.paymentId : '';
            const signature = typeof payment.signature === 'string' ? payment.signature : '';
            requireBody(
                /^order_[A-Za-z0-9]+$/.test(razorpayOrderId) &&
                /^pay_[A-Za-z0-9]+$/.test(razorpayPaymentId) &&
                verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature),
                'Razorpay payment verification failed.'
            );

            const expectedAmount = await getOrderAmount(supabase, req.body.items);
            const [orderResult, paymentResult] = await Promise.all([
                razorpayRequest(`/orders/${encodeURIComponent(razorpayOrderId)}`),
                razorpayRequest(`/payments/${encodeURIComponent(razorpayPaymentId)}`)
            ]);
            if (
                orderResult.id !== razorpayOrderId ||
                orderResult.currency !== 'INR' ||
                Number(orderResult.amount) !== expectedAmount * 100 ||
                orderResult.notes?.user_id !== req.authUser.id ||
                orderResult.notes?.items_hash !== itemsHash(req.body.items) ||
                paymentResult.order_id !== razorpayOrderId ||
                paymentResult.status !== 'captured' ||
                paymentResult.currency !== 'INR' ||
                Number(paymentResult.amount) !== expectedAmount * 100
            ) {
                throw apiError('Razorpay has not confirmed the full payment for these order items.', 402);
            }
            paidAmount = Number(paymentResult.amount) / 100;
            const { data: existingOrder, error: existingOrderError } = await supabase
                .from('orders')
                .select('*, order_items(*)')
                .eq('user_id', req.authUser.id)
                .eq('razorpay_payment_id', razorpayPaymentId)
                .maybeSingle();
            if (existingOrderError) {
                throw apiError('Could not check the existing payment order.', 500);
            }
            if (existingOrder) {
                res.status(200).json({ order: toOrder(existingOrder) });
                return;
            }
        }

        const { data: orderId, error } = await supabase.rpc('create_customer_order', {
            p_user_id: req.authUser.id,
            p_name: req.body.name.trim(),
            p_phone: req.body.phone.trim(),
            p_address: req.body.address.trim(),
            p_payment_method: req.body.paymentMethod,
            p_location_latitude: req.body.location?.latitude ?? null,
            p_location_longitude: req.body.location?.longitude ?? null,
            p_location_accuracy_m: req.body.location?.accuracy ?? null,
            p_location_captured_at: req.body.location?.capturedAt ?? null,
            p_paid_amount: paidAmount,
            p_razorpay_order_id: razorpayOrderId,
            p_razorpay_payment_id: razorpayPaymentId,
            p_items: req.body.items.map(item => ({
                menu_item_id: item.menuItemId,
                quantity: item.qty
            }))
        });

        if (error || !orderId) {
            console.error('Supabase order creation failed:', error?.message || 'No order ID returned.');
            throw apiError('Could not place the order. Please try again.', 500);
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*, order_items(*)')
            .eq('id', orderId)
            .single();

        if (orderError || !order) {
            console.error('Supabase created order could not be reloaded:', orderError?.message);
            throw apiError('The order was placed but could not be loaded. Contact the restaurant with order ID ' + orderId + '.', 500);
        }

        res.status(201).json({ order: toOrder(order) });
    }));

    app.use((error, req, res, next) => {
        if (!error.statusCode || error.statusCode >= 500) {
            console.error('API request failed:', {
                method: req.method,
                path: req.path,
                message: error.message
            });
        }

        if (res.headersSent) {
            return next(error);
        }

        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'The server could not complete the request.'
        });
    });

    return app;
}

const app = createApiApp();

module.exports = {
    app,
    createApiApp,
    validators: { validMenu, validPosters, validOrder, validOrderItems },
    cancellation: { calculateCancellation, verifyRazorpaySignature, itemsHash }
};
