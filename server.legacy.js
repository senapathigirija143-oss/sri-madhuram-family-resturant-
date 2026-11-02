
// Legacy JSON-file backend retained as a rollback reference during migration.
require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = __dirname;

const storageDirectory = path.join(root, '.restaurant-data');
const storePath = path.join(storageDirectory, 'store.json');
const customersPath = path.join(storageDirectory, 'customers.json');

const orderStatuses = [
    'Pending',
    'Approved',
    'Cooking',
    'Out for Delivery',
    'Delivered'
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const initialStore = {
    menu: [
        {
            id: 1,
            name: 'Paneer Tikka Tandoori',
            category: 'Starters & Tandoor',
            price: 280,
            image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500&q=80',
            description: 'Cottage cheese marinated in spices.'
        },
        {
            id: 2,
            name: 'Chicken 65 Special',
            category: 'Starters & Tandoor',
            price: 290,
            image: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?w=500&q=80',
            description: 'Spicy deep-fried chicken.'
        },
        {
            id: 3,
            name: 'Special Hyderabadi Dum Biryani',
            category: 'Biryani & Rice',
            price: 340,
            image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&q=80',
            description: 'Fragrant basmati rice dum cooked.'
        },
        {
            id: 4,
            name: 'Butter Chicken Masala',
            category: 'Main Course',
            price: 320,
            image: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&q=80',
            description: 'Rich creamy tomato gravy.'
        }
    ],
    posters: [],
    orders: [
        {
            id: 'ORD-1001',
            name: 'Ramesh Kumar',
            phone: '9876543210',
            type: 'Delivery',
            total: 690,
            payment: 'UPI',
            status: 'Approved',
            address: 'Flat 10, Gajuwaka, Vizag',
            items: []
        },
        {
            id: 'ORD-1002',
            name: 'Priya Sharma',
            phone: '9123456789',
            type: 'Delivery',
            total: 420,
            payment: 'COD',
            status: 'Pending',
            address: 'Flat 202, RK Beach, Vizag',
            items: []
        }
    ]
};

let store;
let writes = Promise.resolve();

const otpStore = new Map();
const verifiedEmailStore = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// -------------------- VALIDATION --------------------

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
            Number.isFinite(item.id) &&
            typeof item.name === 'string' &&
            item.name.trim().length > 0 &&
            item.name.length <= 100 &&
            typeof item.category === 'string' &&
            item.category.trim().length > 0 &&
            item.category.length <= 60 &&
            Number.isFinite(item.price) &&
            item.price > 0 &&
            isHttpUrl(item.image) &&
            typeof item.description === 'string'
        );
}

function validPosters(posters) {
    return Array.isArray(posters) &&
        posters.length <= 100 &&
        posters.every(poster =>
            poster &&
            Number.isFinite(poster.id) &&
            typeof poster.title === 'string' &&
            poster.title.trim().length > 0 &&
            poster.title.length <= 100 &&
            isHttpUrl(poster.image)
        );
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
        Number.isFinite(order.total) &&
        order.total > 0 &&
        ['upi', 'cod', 'UPI', 'COD'].includes(
            order.paymentMethod || order.payment
        ) &&
        Array.isArray(order.items) &&
        order.items.length > 0 &&
        order.items.length <= 50 &&
        order.items.every(item =>
            item &&
            typeof item.name === 'string' &&
            item.name.length <= 100 &&
            Number.isInteger(item.qty) &&
            item.qty > 0 &&
            item.qty <= 100 &&
            Number.isFinite(item.price) &&
            item.price > 0
        );
}

// -------------------- ADMIN AUTHENTICATION --------------------

function adminOnly(req, res, next) {
    const expected = process.env.ADMIN_API_KEY;
    const provided = req.get('x-admin-key') || '';

    if (!expected) {
        return res.status(503).json({
            error: 'Admin API is not configured. Set ADMIN_API_KEY in .env.'
        });
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);

    if (
        expectedBuffer.length !== providedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
        return res.status(401).json({
            error: 'Administrator key is invalid.'
        });
    }

    next();
}

// -------------------- RESTAURANT DATA STORAGE --------------------

async function saveStore() {
    const snapshot = JSON.stringify(store, null, 2);

    writes = writes.catch(() => {}).then(async () => {
        const temporaryPath = `${storePath}.tmp`;

        await fs.writeFile(temporaryPath, snapshot, 'utf8');
        await fs.rename(temporaryPath, storePath);
    });

    await writes;
}

async function readCustomers() {
    try {
        const data = await fs.readFile(customersPath, 'utf8');
        const customers = JSON.parse(data);

        if (!Array.isArray(customers)) {
            throw new Error('Customer data file is invalid.');
        }

        return customers;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function saveCustomers(customers) {
    const temporaryPath = `${customersPath}.tmp`;

    await fs.writeFile(
        temporaryPath,
        JSON.stringify(customers, null, 2),
        'utf8'
    );

    await fs.rename(temporaryPath, customersPath);
}

function hashCustomerPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (error, key) => {
            if (error) {
                reject(error);
            } else {
                resolve(key.toString('hex'));
            }
        });
    });
}

// -------------------- HEALTH AND PUBLIC DATA --------------------

app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});

app.get('/api/public-data', (req, res) => {
    res.json({
        menu: store.menu,
        posters: store.posters
    });
});

// -------------------- ADMIN ROUTES --------------------

app.post('/api/admin/verify', adminOnly, (req, res) => {
    res.json({ ok: true });
});

app.get('/api/admin/data', adminOnly, (req, res) => {
    res.json({ orders: store.orders });
});

app.put('/api/admin/menu', adminOnly, async (req, res, next) => {
    if (!validMenu(req.body.items)) {
        return res.status(400).json({
            error: 'Menu data is invalid.'
        });
    }

    const previousMenu = store.menu;
    store.menu = req.body.items;

    try {
        await saveStore();
        res.json({ menu: store.menu });
    } catch (error) {
        store.menu = previousMenu;
        next(error);
    }
});

app.put('/api/admin/posters', adminOnly, async (req, res, next) => {
    if (!validPosters(req.body.posters)) {
        return res.status(400).json({
            error: 'Poster data is invalid.'
        });
    }

    const previousPosters = store.posters;
    store.posters = req.body.posters;

    try {
        await saveStore();
        res.json({ posters: store.posters });
    } catch (error) {
        store.posters = previousPosters;
        next(error);
    }
});

app.patch('/api/admin/orders/:id', adminOnly, async (req, res, next) => {
    const { status } = req.body;

    if (!orderStatuses.includes(status)) {
        return res.status(400).json({
            error: 'Order status is invalid.'
        });
    }

    const order = store.orders.find(
        item => item.id === req.params.id
    );

    if (!order) {
        return res.status(404).json({
            error: 'Order was not found.'
        });
    }

    const previousStatus = order.status;
    order.status = status;

    try {
        await saveStore();
        res.json({ order });
    } catch (error) {
        order.status = previousStatus;
        next(error);
    }
});

// -------------------- CUSTOMER ORDERS --------------------

app.post('/api/orders', async (req, res, next) => {
    if (!validOrder(req.body)) {
        return res.status(400).json({
            error: 'Order details are invalid.'
        });
    }

    const order = {
        ...req.body,
        id: `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        status: 'Pending',
        type: 'Delivery',
        createdAt: new Date().toISOString()
    };

    store.orders.unshift(order);

    try {
        await saveStore();
        res.status(201).json({ order });
    } catch (error) {
        store.orders.shift();
        next(error);
    }
});

// -------------------- SEND EMAIL OTP --------------------

app.post('/api/send-otp', async (req, res) => {
    const email = String(req.body?.email || '')
        .trim()
        .toLowerCase();

    if (!emailPattern.test(email) || email.length > 254) {
        return res.status(400).json({
            error: 'Enter a valid email address.'
        });
    }

    if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) {
        console.error('Brevo configuration is missing.');

        return res.status(500).json({
            error: 'Email service is not configured on the server.'
        });
    }

    const now = Date.now();
    const previous = otpStore.get(email);

    if (previous && now - previous.sentAt < 60_000) {
        return res.status(429).json({
            error: 'Please wait one minute before requesting another code.'
        });
    }

    const code = crypto.randomInt(100000, 1000000).toString();

    try {
        const response = await fetch(
            'https://api.brevo.com/v3/smtp/email',
            {
                method: 'POST',
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sender: {
                        name: 'Sri Madhuram Family Restaurant',
                        email: process.env.SENDER_EMAIL
                    },
                    to: [{ email }],
                    subject: 'Your verification code',
                    textContent:
                        `Your verification code is ${code}. It expires in 5 minutes.`
                }),
                signal: AbortSignal.timeout(15000)
            }
        );

        if (!response.ok) {
            const providerError = await response.text();

            // Do not log the API key or other secrets.
            console.error('Brevo email error:', {
                status: response.status,
                details: providerError
            });

            return res.status(502).json({
                error: 'Could not send the email. Please check the server terminal.'
            });
        }

        otpStore.set(email, {
            hash: crypto.createHash('sha256')
                .update(code)
                .digest('hex'),
            expiresAt: now + 5 * 60_000,
            sentAt: now,
            attempts: 0
        });

        verifiedEmailStore.delete(email);

        return res.json({
            message: 'Verification code sent to your email.'
        });
    } catch (error) {
        console.error('Email sending failed:', error.message);

        return res.status(502).json({
            error: 'Email delivery failed. Please check the server terminal.'
        });
    }
});

// -------------------- VERIFY EMAIL OTP --------------------

app.post('/api/verify-otp', (req, res) => {
    const email = String(req.body?.email || '')
        .trim()
        .toLowerCase();

    const code = String(req.body?.code || '');
    const record = otpStore.get(email);

    if (!record || Date.now() > record.expiresAt) {
        otpStore.delete(email);

        return res.status(400).json({
            error: 'Code expired or not requested. Please request a new code.'
        });
    }

    record.attempts += 1;

    if (record.attempts > 5) {
        otpStore.delete(email);

        return res.status(429).json({
            error: 'Too many attempts. Request a new code.'
        });
    }

    const submittedHash = crypto.createHash('sha256')
        .update(code)
        .digest('hex');

    if (!/^\d{6}$/.test(code) || submittedHash !== record.hash) {
        return res.status(400).json({
            error: 'Invalid verification code.'
        });
    }

    otpStore.delete(email);
    verifiedEmailStore.set(email, Date.now() + 5 * 60_000);

    return res.json({
        verified: true,
        message: 'Email verified successfully.'
    });
});

// -------------------- CUSTOMER REGISTRATION --------------------

app.post('/api/customer/register', async (req, res) => {
    try {
        const { name, phone, email, password } = req.body || {};

        const normalizedName =
            typeof name === 'string' ? name.trim() : '';

        const normalizedPhone =
            typeof phone === 'string' ? phone.trim() : '';

        const normalizedEmail =
            typeof email === 'string' ? email.trim().toLowerCase() : '';

        if (
            !normalizedName ||
            normalizedName.length > 100 ||
            !/^\d{10}$/.test(normalizedPhone) ||
            !emailPattern.test(normalizedEmail) ||
            normalizedEmail.length > 254 ||
            typeof password !== 'string' ||
            password.length < 8 ||
            password.length > 128
        ) {
            return res.status(400).json({
                error: 'Enter valid details. Password must be at least 8 characters.'
            });
        }

        const verificationExpiresAt =
            verifiedEmailStore.get(normalizedEmail);

        if (!verificationExpiresAt || Date.now() > verificationExpiresAt) {
            verifiedEmailStore.delete(normalizedEmail);

            return res.status(403).json({
                error: 'Verify your email address before creating an account.'
            });
        }

        const customers = await readCustomers();

        if (customers.some(c => c.phone === normalizedPhone)) {
            return res.status(409).json({
                error: 'This mobile number is already registered. Please sign in.'
            });
        }

        if (customers.some(c => c.email === normalizedEmail)) {
            return res.status(409).json({
                error: 'This email is already registered.'
            });
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = await hashCustomerPassword(password, salt);

        customers.push({
            id: crypto.randomUUID(),
            name: normalizedName,
            phone: normalizedPhone,
            email: normalizedEmail,
            salt,
            passwordHash,
            createdAt: new Date().toISOString()
        });

        await saveCustomers(customers);
        verifiedEmailStore.delete(normalizedEmail);

        return res.status(201).json({
            success: true,
            message: 'Account created. You can now sign in.'
        });
    } catch (error) {
        console.error('Customer registration error:', error.message);

        return res.status(500).json({
            error: 'Could not create account. Please try again.'
        });
    }
});

// -------------------- CUSTOMER LOGIN --------------------

app.post('/api/customer/login', async (req, res) => {
    try {
        const { phone, password } = req.body || {};

        const normalizedPhone =
            typeof phone === 'string' ? phone.trim() : '';

        if (
            !/^\d{10}$/.test(normalizedPhone) ||
            typeof password !== 'string' ||
            password.length > 128
        ) {
            return res.status(400).json({
                error: 'Enter your registered mobile number and password.'
            });
        }

        const customers = await readCustomers();

        const customer = customers.find(
            c => c.phone === normalizedPhone
        );

        if (!customer) {
            return res.status(401).json({
                error: 'Account not found. Please register first.'
            });
        }

        const submittedHash = await hashCustomerPassword(
            password,
            customer.salt
        );

        const submitted = Buffer.from(submittedHash, 'hex');
        const stored = Buffer.from(customer.passwordHash, 'hex');

        if (
            submitted.length !== stored.length ||
            !crypto.timingSafeEqual(submitted, stored)
        ) {
            return res.status(401).json({
                error: 'Invalid mobile number or password.'
            });
        }

        return res.json({
            success: true,
            customer: {
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                email: customer.email
            }
        });
    } catch (error) {
        console.error('Customer login error:', error.message);

        return res.status(500).json({
            error: 'Login failed. Please try again.'
        });
    }
});

// -------------------- STATIC WEBSITE AND ERROR HANDLER --------------------

app.use(express.static(root, {
    dotfiles: 'deny',
    index: 'index.html'
}));

app.use((error, req, res, next) => {
    console.error('Request failed:', error.message);

    if (res.headersSent) {
        return next(error);
    }

    return res.status(500).json({
        error: 'The server could not complete the request.'
    });
});

// -------------------- START SERVER --------------------

async function start() {
    await fs.mkdir(storageDirectory, { recursive: true });

    try {
        const saved = JSON.parse(
            await fs.readFile(storePath, 'utf8')
        );

        if (
            !validMenu(saved.menu) ||
            !validPosters(saved.posters) ||
            !Array.isArray(saved.orders)
        ) {
            throw new Error('Restaurant data file has an invalid shape.');
        }

        store = saved;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }

        store = structuredClone(initialStore);
        await saveStore();
    }

    await new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            console.log(
                `Sri Madhuram server listening on http://localhost:${port}`
            );

            if (!process.env.ADMIN_API_KEY) {
                console.warn(
                    'Admin changes are disabled until ADMIN_API_KEY is set in .env.'
                );
            }

            resolve();
        });

        server.once('error', reject);
    });
}

start().catch(error => {
    console.error('Unable to start restaurant server:', error.message);
    process.exitCode = 1;
});
