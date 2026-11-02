const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { app, validators, cancellation } = require('./api');
const { JSDOM } = require('jsdom');

let server;
let baseUrl;

before(async () => {
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});

test('health endpoint is available without database credentials', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
});

test('public menu and poster validators accept existing project data shapes', () => {
    assert.equal(validators.validMenu([{
        id: 1,
        name: 'Biryani',
        category: 'Rice',
        price: 250,
        image: 'https://example.com/dish.jpg',
        description: ''
    }]), true);
    assert.equal(validators.validPosters([{
        id: 1,
        title: 'Weekend offer',
        image: 'https://example.com/poster.jpg'
    }]), true);
    assert.equal(validators.validOrder({
        name: 'Customer',
        phone: '9876543210',
        address: 'Restaurant delivery address',
        paymentMethod: 'upi',
        items: [{ menuItemId: 1, qty: 2 }]
    }), true);
});

test('orders accept complete GPS data and reject incomplete or out-of-range locations', () => {
    const order = {
        name: 'Customer',
        phone: '9876543210',
        address: 'Restaurant delivery address',
        paymentMethod: 'upi',
        items: [{ menuItemId: 1, qty: 2 }]
    };

    assert.equal(validators.validOrder({
        ...order,
        location: {
            latitude: 17.6868,
            longitude: 83.2185,
            accuracy: 12,
            capturedAt: '2026-10-31T12:00:00.000Z'
        }
    }), true);
    assert.equal(validators.validOrder({
        ...order,
        location: { latitude: 91, longitude: 83.2185, accuracy: 12, capturedAt: '2026-10-31T12:00:00.000Z' }
    }), false);
    assert.equal(validators.validOrder({
        ...order,
        location: { latitude: 17.6868, longitude: 83.2185 }
    }), false);
    assert.equal(validators.validOrder(order), true);
});

test('order item validation rejects duplicate menu items before payment creation', () => {
    assert.equal(validators.validOrderItems([{ menuItemId: 1, qty: 2 }]), true);
    assert.equal(validators.validOrderItems([
        { menuItemId: 1, qty: 1 },
        { menuItemId: 1, qty: 2 }
    ]), false);
});

test('cancellation preview calculates exact stage deductions from saved order amounts', () => {
    assert.deepEqual(cancellation.calculateCancellation({
        status: 'Cooking',
        paid_amount: '325.00'
    }), {
        stage: 'restaurant',
        policy: 'restaurant_stage_full_refund',
        paidAmount: 325,
        foodMakingDeduction: 0,
        deliveryDeduction: 0,
        refundAmount: 325
    });

    assert.deepEqual(cancellation.calculateCancellation({
        status: 'Out for Delivery',
        paid_amount: '325.00',
        food_subtotal: '250.00',
        delivery_charge: '30.00'
    }), {
        stage: 'delivery',
        policy: 'delivery_stage_deductions',
        paidAmount: 325,
        foodMakingDeduction: 25,
        deliveryDeduction: 30,
        refundAmount: 270
    });

    assert.equal(cancellation.calculateCancellation({
        status: 'Out for Delivery',
        paid_amount: '20.00',
        food_subtotal: '250.00',
        delivery_charge: '30.00'
    }).refundAmount, 0);

    assert.throws(
        () => cancellation.calculateCancellation({
            status: 'Delivered',
            paid_amount: '325.00',
            food_subtotal: '250.00',
            delivery_charge: '30.00'
        }),
        { statusCode: 409 }
    );
});

test('Razorpay payment signatures are verified with the server secret', () => {
    const previousSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_SECRET = 'test-secret';
    try {
        const orderId = 'order_123';
        const paymentId = 'pay_456';
        const signature = crypto.createHmac('sha256', 'test-secret')
            .update(`${orderId}|${paymentId}`)
            .digest('hex');
        assert.equal(cancellation.verifyRazorpaySignature(orderId, paymentId, signature), true);
        assert.equal(cancellation.verifyRazorpaySignature(orderId, paymentId, '0'.repeat(64)), false);
    } finally {
        if (previousSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
        else process.env.RAZORPAY_KEY_SECRET = previousSecret;
    }
});

test('customer cancellation endpoints require a signed-in customer', async () => {
    const response = await fetch(`${baseUrl}/api/customer/orders/ORD-1/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Changed my mind' })
    });
    assert.equal(response.status, 401);
});

test('OTP and customer registration reject malformed input before contacting Supabase', async () => {
    const otpResponse = await fetch(`${baseUrl}/api/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' })
    });
    assert.equal(otpResponse.status, 400);

    const registrationResponse = await fetch(`${baseUrl}/api/customer/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
    assert.equal(registrationResponse.status, 400);
});

test('admin endpoints reject requests without a Supabase session', async () => {
    const response = await fetch(`${baseUrl}/api/admin/verify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key': 'legacy-key-is-not-accepted'
        },
        body: JSON.stringify({})
    });
    assert.equal(response.status, 401);
});

test('customer orders reject malformed requests before database access', async () => {
    const response = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
});

test('homepage renders public menu and restaurant data returned by the API', async () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'http://localhost/',
        beforeParse(window) {
            window.tailwind = {};
            window.fetch = async () => ({
                ok: true,
                json: async () => ({
                    menu: [{
                        id: 1,
                        name: 'Supabase Biryani',
                        category: 'Biryani & Rice',
                        price: 250,
                        image: 'https://example.com/dish.jpg',
                        description: 'Test dish'
                    }, {
                        id: 2,
                        name: 'Supabase Paneer Tikka',
                        category: 'Starters & Tandoor',
                        price: 220,
                        image: 'https://example.com/tikka.jpg',
                        description: 'Test starter'
                    }],
                    posters: [],
                    settings: {
                        restaurant_name: 'Sri Madhuram Family Restaurant',
                        phone: '+91 98765 43210',
                        email: 'info@srimadhuram.com',
                        opening_hours: '11:00 AM - 11:00 PM'
                    }
                })
            });
            window.alert = () => {};
        }
    });

    await new Promise(resolve => {
        dom.window.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.match(dom.window.document.getElementById('menu-grid').textContent, /Supabase Biryani/);
    assert.match(dom.window.document.getElementById('menu-grid').textContent, /Supabase Paneer Tikka/);
    assert.deepEqual(
        [...dom.window.document.querySelectorAll('.menu-category-section')].map(section =>
            section.dataset.category
        ),
        ['Biryani & Rice', 'Starters & Tandoor']
    );
    dom.window.selectCategory('Biryani & Rice');
    assert.equal(dom.window.document.querySelectorAll('.menu-category-section').length, 1);
    assert.match(dom.window.document.getElementById('menu-grid').textContent, /Supabase Biryani/);
    assert.doesNotMatch(dom.window.document.getElementById('menu-grid').textContent, /Supabase Paneer Tikka/);
    dom.window.selectCategory('All Items');
    dom.window.document.getElementById('menu-search-input').value = 'Paneer';
    dom.window.filterMenuSearch();
    assert.equal(dom.window.document.querySelectorAll('.menu-category-section').length, 1);
    assert.match(dom.window.document.getElementById('menu-grid').textContent, /Supabase Paneer Tikka/);
    dom.window.document.getElementById('menu-search-input').value = '';
    assert.equal(
        dom.window.document.getElementById('footer-restaurant-phone').textContent,
        '+91 98765 43210'
    );
    const policySections = dom.window.document.querySelectorAll(
        '[aria-label="Cancellation and refund policies"]'
    );
    assert.equal(policySections.length, 3);
    for (const section of policySections) {
        assert.match(section.textContent, /Policy 1 – Cancellation at Restaurant Stage/);
        assert.match(section.textContent, /Policy 2 – Cancellation at Delivery Stage/);
    }
    assert.ok(dom.window.document.getElementById('trackerOrderId'));
    dom.window.close();
});
