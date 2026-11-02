/**
 * SRI MADHURAM FAMILY RESTAURANT - UNIFIED PORTAL LOGIC
 * VERSION: Strict Auth Guard Enabled
 */
// ADMIN-ONLY PERMISSION CHECK
function requireAdmin() {
    if (state.userRole !== "admin" || state.activePortal !== "admin") {
        alert("Access denied. Only the Administrator can manage menu items.");
        return false;
    }

    return true;
}

const state = {
    activePortal: 'customer',
    selectedCategory: 'All Items',
    userRole: null, 
    userPhone: null,
    cart: [],
    deliveryAddress: null, 
    paymentMethod: 'upi',
    activeCustomerOrder: null,
    isCheckoutFlow: false, 
    ordersList: [
        { id: "ORD-1001", name: "Ramesh Kumar", phone: "9876543210", type: "Delivery", total: 690, payment: "UPI", status: "Approved", address: "Flat 10, Gajuwaka, Vizag" },
        { id: "ORD-1002", name: "Priya Sharma", phone: "9123456789", type: "Delivery", total: 420, payment: "COD", status: "Pending", address: "Flat 202, RK Beach, Vizag" }
    ],
    advertisements: [
        { id: 1, title: "Festival Biryani Dhamaka", description: "Get 20% off on all family packs this weekend!", category: "Festival Specials", image: "https://images.unsplash.com/photo-1589302168068-967d63d6767d?w=500", is_published: true, expires_at: "2025-12-31", button_label: "Order Now", button_url: "#" },
        { id: 2, title: "New Paneer Tikka Roast", description: "Try our new smoky charcoal roasted paneer tikka.", category: "New Menu Launches", image: "https://images.unsplash.com/photo-1567184109475-717f3f74f847?w=500", is_published: true, expires_at: "2025-12-31", button_label: "View Details", button_url: "#" }
    ],
    posters: [],
    selectedTableId: null,
    tablesData: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        status: (i === 1 || i === 5) ? 'occupied' : 'available',
        seats: i % 2 === 0 ? 4 : 2,
        items: (i === 1 || i === 5) ? [{ name: "Dum Biryani", qty: 2, price: 340 }] : []
    })),
    kdsOrders: [
        { id: 501, title: "Table 1 Ticket", items: ["Dum Biryani x2"], time: "5m", status: "Cooking" }
    ],
    categories: [
        { id: 'all', name: 'All Items', icon: 'fa-utensils' },
        { id: 'biryani', name: 'Biryani & Rice', img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=200&q=80' },
        { id: 'starters', name: 'Starters & Tandoor', img: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=200&q=80' },
        { id: 'main', name: 'Main Course', img: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=200&q=80' },
        { id: 'breads', name: 'Breads & Naan', img: 'https://images.unsplash.com/photo-1626074353765-517a681e40be?w=200&q=80' },
        { id: 'desserts', name: 'Desserts & Drinks', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=200&q=80' }
    ],
    menu: [
        { id: 1, name: "Paneer Tikka Tandoori", category: "Starters & Tandoor", price: 280, image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500&q=80", description: "Cottage cheese marinated in spices." },
        { id: 2, name: "Chicken 65 Special", category: "Starters & Tandoor", price: 290, image: "https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?w=500&q=80", description: "Spicy deep-fried chicken." },
        { id: 3, name: "Special Hyderabadi Dum Biryani", category: "Biryani & Rice", price: 340, image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&q=80", description: "Fragrant basmati rice dum cooked." },
        { id: 4, name: "Butter Chicken Masala", category: "Main Course", price: 320, image: "https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&q=80", description: "Rich creamy tomato gravy." }
    ]
};

document.addEventListener('DOMContentLoaded', () => {
    loadSavedPosters();
    renderCategoryCarousel(); renderCategoryPills(); renderMenuGrid();
    renderTablesGrid(); renderKDSOrders(); renderAdminDashboard(); renderAdminMenu();
    renderAdminPosters(); renderUpdates();
    document.getElementById('poster-image').addEventListener('input', updatePosterPreview);
    document.getElementById('poster-title').addEventListener('input', updatePosterPreview);
    updateNavigationVisibility();
});

const savedPostersKey = 'sriMadhuramPosters';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function loadSavedPosters() {
    try {
        const savedPosters = JSON.parse(localStorage.getItem(savedPostersKey) || '[]');
        if (Array.isArray(savedPosters) && savedPosters.every(poster =>
            poster && Number.isFinite(poster.id) && typeof poster.title === 'string' &&
            typeof poster.image === 'string')) {
            state.posters = savedPosters;
        }
    } catch (error) {
        console.error('Unable to load saved posters:', error);
    }
}

function persistPosters() {
    try {
        localStorage.setItem(savedPostersKey, JSON.stringify(state.posters));
        return true;
    } catch (error) {
        console.error('Unable to save posters:', error);
        alert('Posters could not be saved in this browser. Check browser storage and try again.');
        return false;
    }
}

// --- AUTHENTICATION ---
function toggleAuthMode(mode) {
    const signinForm = document.getElementById('signin-form');
    const regForm = document.getElementById('reg-form');
    const signinTab = document.getElementById('btn-signin-tab');
    const regTab = document.getElementById('btn-reg-tab');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    if (mode === 'signin') {
        signinForm.classList.remove('hidden'); regForm.classList.add('hidden');
        signinTab.className = "flex-1 py-2 rounded-lg bg-white shadow text-brand-red";
        regTab.className = "flex-1 py-2 rounded-lg text-gray-600";
        title.innerText = "Sign In"; subtitle.innerText = "Welcome back to Sri Madhuram";
    } else {
        signinForm.classList.add('hidden'); regForm.classList.remove('hidden');
        regTab.className = "flex-1 py-2 rounded-lg bg-white shadow text-brand-red";
        signinTab.className = "flex-1 py-2 rounded-lg text-gray-600";
        title.innerText = "Register"; subtitle.innerText = "Join our family of food lovers";
    }
}

function handleSignin(e) {
    e.preventDefault();
    state.userRole = document.getElementById('auth-role').value;
    state.userPhone = document.getElementById('auth-phone').value;
    completeAuth();
}

function handleRegister(e) {
    e.preventDefault();
    state.userRole = 'customer';
    state.userPhone = document.getElementById('reg-phone').value;
    state.deliveryAddress = {
        name: document.getElementById('reg-name').value,
        phone: state.userPhone,
        house: document.getElementById('reg-addr-house').value,
        street: '',
        area: '',
        city: document.getElementById('reg-addr-city').value,
        pin: ''
    };
    completeAuth();
}

function completeAuth() {
    document.getElementById('header-auth-text').innerText = state.userRole === 'customer' ? `+91 ${state.userPhone.slice(-4)}` : state.userRole.toUpperCase();
    closeAuthModal();
    updateNavigationVisibility();
    switchPortal(state.userRole);
    renderMenuGrid(); // REFRESH MENU to change "Login to Order" -> "Add to Order"
}

function updateNavigationVisibility() {
    const navTabs = document.getElementById('navTabsContainer');
    const tabOnline = document.getElementById('tabOnline');
    const tabStaff = document.getElementById('tabStaff');
    const tabAdmin = document.getElementById('tabAdmin');
    const trackerBtn = document.getElementById('header-track-btn');
    if (!state.userRole) { navTabs.classList.add('hidden'); trackerBtn.classList.add('hidden'); return; }
    navTabs.classList.remove('hidden'); tabOnline.classList.remove('hidden');
    if (state.userRole === 'staff' || state.userRole === 'admin') tabStaff.classList.remove('hidden');
    if (state.userRole === 'admin') tabAdmin.classList.remove('hidden');
    if (state.userRole === 'customer' && state.activeCustomerOrder) trackerBtn.classList.remove('hidden');
}

function switchPortal(portal) {
    if (!state.userRole && portal !== 'customer') { openAuthModal(); return; }
    if (state.userRole === 'customer' && portal !== 'customer') return;
    if (state.userRole === 'staff' && portal === 'admin') return;
    state.activePortal = portal;
    document.getElementById('customer-portal').classList.add('hidden');
    document.getElementById('staff-portal').classList.add('hidden');
    document.getElementById('admin-portal').classList.add('hidden');
    document.getElementById(`${portal}-portal`).classList.remove('hidden');
    document.getElementById('tabOnline').className = portal === 'customer' ? "px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-red text-white flex items-center gap-2" : "px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white/50 flex items-center gap-2";
    document.getElementById('tabStaff').className = portal === 'staff' ? "px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-red text-white flex items-center gap-2" : "px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white/50 flex items-center gap-2";
    document.getElementById('tabAdmin').className = portal === 'admin' ? "px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-red text-white flex items-center gap-2" : "px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white/50 flex items-center gap-2";
}

// --- CUSTOMER FLOW ---
function renderCategoryCarousel() {
    const container = document.getElementById('category-visual-list');
    container.innerHTML = state.categories.filter(c => c.id !== 'all').map(cat => `
        <div onclick="selectCategory('${cat.name}')" class="flex-shrink-0 cursor-pointer flex flex-col items-center group px-4">
            <div class="w-28 h-28 md:w-36 md:h-36 rounded-full overflow-hidden border-4 border-brand-red p-1 bg-white shadow-md group-hover:scale-110 transition transform duration-300">
                <img src="${cat.img}" class="w-full h-full object-cover rounded-full">
            </div>
            <span class="text-sm md:text-lg font-black text-gray-800 mt-3 text-center group-hover:text-brand-red transition-colors">${cat.name}</span>
        </div>
    `).join('');
}

function renderCategoryPills() {
    const container = document.getElementById('category-pills');
    container.innerHTML = state.categories.map(cat => `
        <button onclick="selectCategory('${cat.name}')" class="px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${state.selectedCategory === cat.name ? 'bg-brand-red text-white' : 'bg-white text-gray-700 border'}">${cat.name}</button>
    `).join('');
}

function selectCategory(name) { state.selectedCategory = name; renderCategoryPills(); renderMenuGrid(); }

function renderMenuGrid() {
    const container = document.getElementById('menu-grid');
    const search = document.getElementById('menu-search-input').value.toLowerCase();
    const filtered = state.menu.filter(item => (state.selectedCategory === 'All Items' || item.category === state.selectedCategory) && (item.name.toLowerCase().includes(search)));
    container.innerHTML = filtered.map(item => `
        <div class="bg-white rounded-3xl overflow-hidden border shadow-sm hover:shadow-xl transition flex flex-col justify-between">
            <div>
                <div class="relative h-44 overflow-hidden">
                    <img src="${item.image}" class="w-full h-full object-cover hover:scale-110 transition duration-500">
                    <span class="absolute top-3 right-3 bg-stone-900/80 text-white font-extrabold text-xs px-2 py-1 rounded-full">₹${item.price}</span>
                </div>
                <div class="p-4">
                    <h4 class="font-extrabold text-gray-900">${item.name}</h4>
                    <p class="text-xs text-gray-500 line-clamp-2">${item.description}</p>
                </div>
            </div>
            <div class="p-4 pt-0">
                <button onclick="addToCart(${item.id})" class="w-full bg-slate-800 text-white font-bold py-2 rounded-2xl text-xs hover:bg-black transition flex items-center justify-center gap-1">
                    <i class="fa-solid ${state.userRole ? 'fa-plus' : 'fa-lock'} text-[10px]"></i> ${state.userRole ? 'Add to Order' : 'Sign in to Order'}
                </button>
            </div>
        </div>
    `).join('');
}

function filterMenuSearch() { renderMenuGrid(); }

// FIX: STICKT AUTH GUARD FOR BASKET
function addToCart(id) {
    if (!state.userRole) {
        openAuthModal();
        return;
    }
    const dish = state.menu.find(m => m.id === id);
    if (!dish) return;
    const existing = state.cart.find(c => c.id === id);
    if (existing) { existing.qty++; } else { state.cart.push({ ...dish, qty: 1 }); }
    updateCartUI();
    openCart();
}

function updateCartUI() {
    const list = document.getElementById('cart-items-list');
    const orderBtn = document.querySelector('#cart-drawer button[onclick="proceedToAddressStep()"]');
    if (state.cart.length === 0) {
        list.innerHTML = `<p class="text-center text-gray-400 py-12">Basket is empty.</p>`;
        if(orderBtn) {
            orderBtn.className = "w-full bg-gray-400 text-gray-200 font-extrabold py-3 rounded-xl text-sm cursor-not-allowed";
            orderBtn.innerText = "Add Items to Order";
        }
        document.getElementById('cart-subtotal').innerText = '₹0.00';
        document.getElementById('cart-tax').innerText = '₹0.00';
        document.getElementById('cart-grand-total').innerText = '₹0.00';
        return;
    }
    list.innerHTML = state.cart.map(item => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-2xl border">
            <div class="flex items-center space-x-3">
                <img src="${item.image}" class="w-12 h-12 object-cover rounded-xl">
                <div><p class="font-bold text-xs">${item.name}</p><p class="text-xs text-gray-400">₹${item.price}</p></div>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="changeCartQty(${item.id}, -1)" class="w-6 h-6 bg-white border rounded-lg">-</button>
                <span class="text-xs font-bold">${item.qty}</span>
                <button onclick="changeCartQty(${item.id}, 1)" class="w-6 h-6 bg-white border rounded-lg">+</button>
            </div>
        </div>
    `).join('');
    if(orderBtn) {
        orderBtn.className = "w-full bg-brand-red hover:bg-brand-darkRed text-white font-extrabold py-3 rounded-xl text-sm transition";
        orderBtn.innerText = "Place Order";
    }
    const sub = state.cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const tax = sub * 0.05;
    const total = Math.round(sub + tax + 30);
    document.getElementById('cart-subtotal').innerText = `₹${sub.toFixed(2)}`;
    document.getElementById('cart-tax').innerText = `₹${tax.toFixed(2)}`;
    document.getElementById('cart-grand-total').innerText = `₹${total.toFixed(2)}`;
}

function changeCartQty(id, delta) {
    const item = state.cart.find(c => c.id === id);
    if (item) { item.qty += delta; if (item.qty <= 0) state.cart = state.cart.filter(c => c.id !== id); }
    updateCartUI();
}

function openCart() {
    if (!state.userRole) {
        alert("Please sign in to view your basket.");
        openAuthModal();
        return;
    }
    document.getElementById('cart-drawer')?.classList.remove('hidden');
}
function closeCart() { document.getElementById('cart-drawer')?.classList.add('hidden'); }

function proceedToAddressStep() {
    if (!state.userRole) { openAuthModal(); return; }
    if (state.cart.length === 0) { alert("Your basket is empty! Please add items first."); return; }
    state.isCheckoutFlow = true; 
    closeCart(); openAddressModal(); 
}

function openAddressModal() {
    state.isCheckoutFlow = false; 
    document.getElementById('address-modal').classList.remove('hidden'); 
}
function closeAddressModal() { document.getElementById('address-modal').classList.add('hidden'); }

function fetchLiveGPSLocation() {
    state.deliveryAddress = {
        name: state.userRole === 'customer' ? 'User' : 'Guest',
        phone: state.userPhone || '9876543210',
        house: 'GPS Located',
        street: 'Gajuwaka Main Road',
        area: 'Near Apollo Hospital',
        city: 'Visakhapatnam',
        pin: '530026'
    };
    updateHeroAddress();
    if (state.isCheckoutFlow) openPaymentModal(); else closeAddressModal();
}

function confirmManualAddress() {
    const name = document.getElementById('loc-name').value;
    const phone = document.getElementById('loc-phone').value;
    const house = document.getElementById('loc-house').value;
    const street = document.getElementById('loc-street').value;
    const area = document.getElementById('loc-area').value;
    const city = document.getElementById('loc-city').value;
    const pin = document.getElementById('loc-pin').value;

    if (!name || !phone || !house || !street || !area || !city || !pin) {
        alert("Please fill in all required address fields.");
        return;
    }

    state.deliveryAddress = { name, phone, house, street, area, city, pin };
    updateHeroAddress();
    if (state.isCheckoutFlow) openPaymentModal(); else closeAddressModal();
}

function updateHeroAddress() {
    if (state.deliveryAddress) {
        document.getElementById('hero-delivery-location').innerText = `${state.deliveryAddress.area}, ${state.deliveryAddress.city}`;
    } else {
        document.getElementById('hero-delivery-location').innerText = "Select Address";
    }
}

function openPaymentModal() {
    const sub = state.cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const total = Math.round(sub * 1.05 + 30);
    document.getElementById('paymentModalTotal').innerText = `₹${total}`;
    document.getElementById('payment-modal').classList.remove('hidden');
}

function closePaymentModal() { document.getElementById('payment-modal').classList.add('hidden'); }

function selectPaymentOption(mode) {
    state.paymentMethod = mode;
    document.getElementById('payment-upi-box').classList.toggle('hidden', mode === 'cod');
    document.getElementById('payment-cod-box').classList.toggle('hidden', mode === 'upi');
    document.getElementById('opt-upi').className = mode === 'upi' ? "p-3.5 rounded-2xl border-2 border-brand-red bg-red-50 text-brand-red font-bold text-sm flex flex-col items-center gap-1" : "p-3.5 rounded-2xl border-2 border-gray-200 bg-white text-gray-600 font-bold text-sm flex flex-col items-center gap-1";
    document.getElementById('opt-cod').className = mode === 'cod' ? "p-3.5 rounded-2xl border-2 border-brand-red bg-red-50 text-brand-red font-bold text-sm flex flex-col items-center gap-1" : "p-3.5 rounded-2xl border-2 border-gray-200 bg-white text-gray-600 font-bold text-sm flex flex-col items-center gap-1";
}

async function verifyAndFinalizeOrder() {
    const btn = document.getElementById('pay-confirm-btn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Verifying Payment... Please wait";
    btn.className = "w-full bg-gray-400 text-white font-black py-3 rounded-xl text-sm cursor-not-allowed";
    await new Promise(resolve => setTimeout(resolve, 2000));
    btn.disabled = false;
    btn.innerText = originalText;
    btn.className = "w-full bg-emerald-600 text-white font-black py-3 rounded-xl text-sm shadow-lg transition hover:bg-emerald-700";
    finalizeOrderAndTrack();
}

function finalizeOrderAndTrack() {
    const sub = state.cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const total = Math.round(sub * 1.05 + 30);
    const orderId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
    const fullAddressStr = `${state.deliveryAddress.house}, ${state.deliveryAddress.street}, ${state.deliveryAddress.area}, ${state.deliveryAddress.city} - ${state.deliveryAddress.pin}`;

    state.activeCustomerOrder = { 
        id: orderId, total, address: fullAddressStr, paymentMethod: state.paymentMethod, phone: state.deliveryAddress.phone, status: 'Pending' 
    };
    state.ordersList.unshift({...state.activeCustomerOrder, name: state.deliveryAddress.name});
    state.cart = []; updateCartUI();
    closePaymentModal(); renderAdminDashboard();
    toggleOrderTrackerModal(true);
    state.isCheckoutFlow = false;
}

function toggleOrderTrackerModal(show = false) {
    const modal = document.getElementById('trackOrderModal');
    if (show) { modal.classList.remove('hidden'); updateTrackerUI(); } else { modal.classList.add('hidden'); }
}

function updateTrackerUI() {
    const order = state.activeCustomerOrder;
    if (!order) return;
    const stepper = document.getElementById('trackerStepper');
    const badge = document.getElementById('trackerStatusBadge');
    const stages = [
        { status: 'Approved', icon: 'fa-check', color: 'bg-emerald-600', text: 'Order Approved' },
        { status: 'Cooking', icon: 'fa-fire', color: 'bg-amber-500', text: 'Chef is Cooking' },
        { status: 'Out for Delivery', icon: 'fa-motorcycle', color: 'bg-blue-500', text: 'Out for Delivery' },
        { status: 'Delivered', icon: 'fa-house-chimney', color: 'bg-green-600', text: 'Order Delivered!' }
    ];
    const currentStageIndex = stages.findIndex(s => s.status === order.status);
    if (order.status === 'Pending') {
        badge.innerText = "Awaiting Approval"; badge.className = "text-xs text-amber-600 font-bold";
        stepper.innerHTML = `<div class="flex items-start space-x-3"><div class="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs animate-pulse">1</div><div><p class="text-xs font-bold text-gray-800">Pending Approval</p><p class="text-[10px] text-gray-400">Waiting for the restaurant manager to confirm</p></div></div>`;
    } else {
        badge.innerText = order.status; badge.className = "text-xs text-emerald-600 font-bold";
        stepper.innerHTML = stages.map((stage, idx) => {
            const isCompleted = idx <= currentStageIndex;
            const isCurrent = idx === currentStageIndex;
            return `<div class="flex items-start space-x-3 ${!isCompleted ? 'opacity-40' : ''}">
                <div class="w-6 h-6 rounded-full ${isCompleted ? stage.color : 'bg-gray-300'} text-white flex items-center justify-center text-xs font-bold mt-0.5 ${isCurrent ? 'animate-bounce' : ''}"><i class="fa-solid ${stage.icon}"></i></div>
                <div><p class="text-xs font-bold ${isCompleted ? 'text-gray-800' : 'text-gray-500'}">${stage.text}</p></div>
            </div>`;
        }).join('');
    }
    document.getElementById('trackerOrderId').innerText = `Order #${order.id}`;
    document.getElementById('trackerTotal').innerText = `₹${order.total}`;
    document.getElementById('trackerAddress').innerText = order.address;
    document.getElementById('trackerPaymentMode').innerText = order.paymentMethod.toUpperCase();
}

// --- STAFF & ADMIN (Preserved) ---
function switchStaffTab(view) {
    document.getElementById('staff-tables-view').classList.toggle('hidden', view !== 'tables');
    document.getElementById('staff-kds-view').classList.toggle('hidden', view !== 'kds');
    document.getElementById('staff-tab-tables').className = view === 'tables' ? "px-4 py-2 rounded-xl text-sm font-bold bg-brand-red text-white" : "px-4 py-2 rounded-xl text-sm font-bold bg-gray-200 text-gray-700";
    document.getElementById('staff-tab-kds').className = view === 'kds' ? "px-4 py-2 rounded-xl text-sm font-bold bg-brand-red text-white" : "px-4 py-2 rounded-xl text-sm font-bold bg-gray-200 text-gray-700";
}
function renderTablesGrid() {
    const container = document.getElementById('tables-grid');
    container.innerHTML = state.tablesData.map(t => `
        <div onclick="openTableBillingModal(${t.id})" class="cursor-pointer p-4 rounded-2xl border-2 ${t.status === 'occupied' ? 'bg-red-50 border-red-300 text-red-900' : 'bg-emerald-50 border-emerald-300 text-emerald-900'} transition transform hover:scale-105">
            <div class="flex justify-between mb-2"><span class="font-extrabold">T-${t.id}</span><span class="text-[10px] font-bold uppercase">${t.status}</span></div>
            <p class="text-xs text-gray-600">${t.seats} Seats</p>
            <p class="text-sm font-black text-brand-red">₹${t.items.reduce((s,i)=>s+(i.price*i.qty),0)}</p>
        </div>`).join('');
}
function renderKDSOrders() {
    const container = document.getElementById('kds-orders-container');
    container.innerHTML = state.kdsOrders.map((order, idx) => `
        <div class="bg-white p-4 rounded-2xl border shadow-sm">
            <div class="flex justify-between border-b pb-2 mb-2">
                <span class="font-bold text-sm">#${order.id} - ${order.title}</span>
                <span class="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-1 rounded">${order.status}</span>
            </div>
            <ul class="text-xs space-y-1 mb-4">${order.items.map(i => `<li>• ${i}</li>`).join('')}</ul>
            <button onclick="updateKDSStatus(${idx})" class="w-full bg-emerald-600 text-white font-bold py-2 rounded-xl text-xs">Mark Ready</button>
        </div>`).join('');
}
function updateKDSStatus(idx) { state.kdsOrders.splice(idx, 1); renderKDSOrders(); }
function openTableBillingModal(id) {
    state.selectedTableId = id;
    const table = state.tablesData.find(t => t.id === id);
    document.getElementById('modal-table-badge').innerText = `T-${id}`;
    document.getElementById('modal-table-subtitle').innerText = `Seats: ${table.seats} | Status: ${table.status}`;
    document.getElementById('table-add-dish-select').innerHTML = state.menu.map(m => `<option value="${m.id}">${m.name} (₹${m.price})</option>`).join('');
    renderTableItems();
    document.getElementById('table-billing-modal').classList.remove('hidden');
}
function renderTableItems() {
    const table = state.tablesData.find(t => t.id === state.selectedTableId);
    const container = document.getElementById('table-order-items-list');
    container.innerHTML = table.items.map((item, idx) => `<div class="flex justify-between"><span>${item.name} x${item.qty}</span><span class="font-bold">₹${item.price * item.qty}</span></div>`).join('');
    document.getElementById('table-total-bill-text').innerText = `₹${table.items.reduce((s,i)=>s+(i.price*i.qty),0)}`;
}
function addItemToSelectedTable() {
    const id = parseInt(document.getElementById('table-add-dish-select').value);
    const dish = state.menu.find(m => m.id === id);
    const table = state.tablesData.find(t => t.id === state.selectedTableId);
    const existing = table.items.find(i => i.name === dish.name);
    if (existing) { existing.qty++; } else { table.items.push({...dish, qty: 1}); }
    table.status = 'occupied';
    state.kdsOrders.push({ id: Math.floor(Math.random() * 900), title: `T-${table.id} Order`, items: [`${dish.name} x1`], status: 'Cooking' });
    renderTableItems(); renderTablesGrid(); renderKDSOrders();
}
function saveTableOrder() {
    const table = state.tablesData.find(t => t.id === state.selectedTableId);
    if (table.items.length === 0) { alert("No items to save."); return; }
    alert(`Order for Table ${table.id} has been saved in the system.`);
    renderTablesGrid();
}
function settleAndClearTable() {
    const table = state.tablesData.find(t => t.id === state.selectedTableId);
    table.items = []; table.status = 'available';
    renderTablesGrid(); closeTableBillingModal();
}
function closeTableBillingModal() { document.getElementById('table-billing-modal').classList.add('hidden'); }
function printTableReceipt() {
    const table = state.tablesData.find(t => t.id === state.selectedTableId);
    document.getElementById('receipt-header-info').innerHTML = `Date: ${new Date().toLocaleDateString()} | Table: #${table.id}`;
    document.getElementById('receipt-items-list').innerHTML = table.items.map(i => `<div style="display:flex;justify-content:space-between;"><span>${i.name} x${i.qty}</span><span>₹${i.price*i.qty}</span></div>`).join('');
    document.getElementById('receipt-total-info').innerText = `Grand Total: ₹${table.items.reduce((s,i)=>s+(i.price*i.qty),0)}`;
    window.print();
}
function switchAdminTab(tab) {
    if (!requireAdmin() || !['stats', 'menu', 'posters'].includes(tab)) return;
    document.getElementById('admin-stats-view').classList.toggle('hidden', tab !== 'stats');
    document.getElementById('admin-menu-view').classList.toggle('hidden', tab !== 'menu');
    document.getElementById('admin-posters-view').classList.toggle('hidden', tab !== 'posters');
    document.getElementById('admin-dashboard-controls').classList.toggle('hidden', tab !== 'stats');
    ['stats', 'menu', 'posters'].forEach(name => {
        document.getElementById(`adm-tab-${name}`).className = tab === name
            ? "px-4 py-2 rounded-xl text-xs font-bold bg-purple-900 text-white"
            : "px-4 py-2 rounded-xl text-xs font-bold bg-gray-200 text-gray-700";
    });
}

function renderAdminPosters() {
    const container = document.getElementById('admin-posters-list');
    if (!container) return;
    container.innerHTML = state.posters.length
        ? state.posters.map(poster => `
            <article class="restaurant-updates-card bg-white rounded-2xl border overflow-hidden">
                <img src="${escapeHtml(poster.image)}" alt="${escapeHtml(poster.title)}" class="w-full h-40 object-cover">
                <div class="p-4 flex items-center justify-between gap-3">
                    <h4 class="font-bold text-sm text-gray-900">${escapeHtml(poster.title)}</h4>
                    <button type="button" onclick="deletePoster(${poster.id})" class="shrink-0 text-red-600 hover:text-red-800 text-xs font-bold" aria-label="Delete ${escapeHtml(poster.title)}">
                        <i class="fa-solid fa-trash"></i> Remove
                    </button>
                </div>
            </article>`).join('')
        : '<p class="text-sm text-gray-500">No promotional posters added yet.</p>';
}

function renderUpdates() {
    const section = document.getElementById('customer-posters');
    const container = document.getElementById('customer-posters-list');
    if (!section || !container) return;
    section.classList.toggle('hidden', state.posters.length === 0);
    container.innerHTML = state.posters.map(poster => `
        <article class="restaurant-updates-card bg-white rounded-2xl border shadow-sm overflow-hidden">
            <img src="${escapeHtml(poster.image)}" alt="${escapeHtml(poster.title)}" class="w-full h-48 object-cover">
            <div class="p-4"><h3 class="font-bold text-gray-900">${escapeHtml(poster.title)}</h3></div>
        </article>`).join('');
}

function updatePosterPreview() {
    const title = document.getElementById('poster-title').value.trim();
    const image = document.getElementById('poster-image').value.trim();
    const previewWrap = document.getElementById('poster-form-preview-wrap');
    const previewImage = document.getElementById('poster-form-preview-image');
    if (!title && !image) {
        previewWrap.classList.add('hidden');
        previewImage.removeAttribute('src');
        return;
    }
    document.getElementById('poster-form-preview-title').innerText = title || 'Poster preview';
    previewImage.src = image;
    previewWrap.classList.toggle('hidden', !image);
}

function savePoster(event) {
    event.preventDefault();
    if (!requireAdmin()) return;
    const title = document.getElementById('poster-title').value.trim();
    const image = document.getElementById('poster-image').value.trim();
    const error = document.getElementById('poster-form-error');
    let imageUrl;
    try {
        imageUrl = new URL(image);
    } catch {
        error.innerText = 'Enter a valid image URL.';
        error.classList.remove('hidden');
        return;
    }
    if (!title || !['http:', 'https:'].includes(imageUrl.protocol)) {
        error.innerText = 'Enter a title and a valid HTTP(S) image URL.';
        error.classList.remove('hidden');
        return;
    }
    const previousPosters = state.posters;
    state.posters = [...state.posters, { id: Date.now(), title, image }];
    if (!persistPosters()) {
        state.posters = previousPosters;
        return;
    }
    document.getElementById('poster-form').reset();
    error.classList.add('hidden');
    updatePosterPreview();
    renderAdminPosters();
    renderUpdates();
}

function deletePoster(id) {
    if (!requireAdmin()) return;
    const previousPosters = state.posters;
    state.posters = state.posters.filter(poster => poster.id !== id);
    if (!persistPosters()) {
        state.posters = previousPosters;
        return;
    }
    renderAdminPosters();
    renderUpdates();
}
function renderAdminDashboard() {
    const body = document.getElementById('admin-orders-table-body');
    const statusFlow = ['Pending', 'Approved', 'Cooking', 'Out for Delivery', 'Delivered'];
    body.innerHTML = state.ordersList.map(o => {
        const currentIndex = statusFlow.indexOf(o.status);
        const nextStatus = statusFlow[currentIndex + 1];
        return `<tr class="text-xs">
            <td class="p-3 font-bold">#${o.id}</td><td class="p-3">${o.name}</td><td class="p-3 font-black text-brand-red">₹${o.total}</td>
            <td class="p-3"><span class="px-2 py-1 rounded-full font-bold ${o.status === 'Delivered' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${o.status}</span></td>
            <td class="p-3">
                ${nextStatus ? `<button onclick="adminUpdateOrder('${o.id}', '${nextStatus}')" class="bg-blue-600 text-white px-3 py-1 rounded-lg font-bold hover:bg-blue-700 transition">Move to ${nextStatus}</button>` : `<span class="text-emerald-600 font-bold">Completed</span>`}
            </td></tr>`;
    }).join('');
    document.getElementById('stat-total-sales').innerText = `₹${state.ordersList.reduce((s,o)=>s+o.total,0)}`;
    document.getElementById('stat-total-orders').innerText = state.ordersList.length;
    document.getElementById('stat-kds-count').innerText = state.kdsOrders.length;
    document.getElementById('stat-occupied-tables').innerText = `${state.tablesData.filter(t=>t.status==='occupied').length}/25`;
}
function adminUpdateOrder(orderId, newStatus) {
    const order = state.ordersList.find(o => o.id === orderId);
    if (!order) return;
    order.status = newStatus;
    if (state.activeCustomerOrder && state.activeCustomerOrder.id === orderId) state.activeCustomerOrder.status = newStatus;
    if (newStatus === 'Approved') {
        state.kdsOrders.push({ id: Math.floor(Math.random() * 900), title: `Delivery ${orderId}`, items: ["Order Items x1"], status: 'Cooking' });
        renderKDSOrders();
    }
    renderAdminDashboard(); updateTrackerUI();
}
function renderAdminMenu() {
    const body = document.getElementById('admin-menu-table-body');
    body.innerHTML = state.menu.map(item => `<tr class="text-xs"><td class="p-3 font-bold">${item.name}</td><td class="p-3 text-xs">${item.category}</td><td class="p-3">₹${item.price}</td><td class="p-3"><button onclick="deleteDish(${item.id})" class="text-red-600"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
}
function deleteDish(id) { if (requireAdmin()) return; { state.menu = state.menu.filter(m => m.id !== id); renderAdminMenu(); renderMenuGrid(); } }

function openAddDishModal() {
    if (!requireAdmin()) return;
    const name = prompt("Dish Name:");
    const price = parseInt(prompt("Price:"));
    const cat = prompt("Category:");
    if (name && price && cat) {
        state.menu.push({ id: Date.now(), name, price, category: cat, image: 'https://images.unsplash.com/photo-1546069901-ba959//w=500', description: 'Added by Admin' });
        renderAdminMenu(); renderMenuGrid();
    }
}
function openAuthModal() { document.getElementById('auth-modal').classList.remove('hidden'); }
function closeAuthModal() { document.getElementById('auth-modal').classList.add('hidden'); }
