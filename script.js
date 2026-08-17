// =====================================================
// ECE DÖNER QR MENÜ PRO
// MÜŞTERİ SAYFASI (index.html)
// Firebase Firestore ile ürünleri okur, sepet yönetir,
// WhatsApp üzerinden sipariş gönderir.
// =====================================================

"use strict";

// =====================================================
// FIREBASE
// =====================================================

const firebaseConfig = {
    apiKey: "AIzaSyCfPqMm1Azo6ZS9ee4NN1d-yBfPv9JaCU",
    authDomain: "ece-2e44c.firebaseapp.com",
    projectId: "ece-2e44c",
    storageBucket: "ece-2e44c.firebasestorage.app",
    messagingSenderId: "937356035748",
    appId: "1:937356035748:web:6c8f79c774f4c3c64b0831",
    measurementId: "G-9VEVNMW5T0"
};

let db = null;

try {

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    db = firebase.firestore();

    console.log("✅ Müşteri Firebase bağlantısı hazır.");

} catch (error) {

    console.error("❌ Firebase başlatılamadı:", error);
}


// =====================================================
// WHATSAPP NUMARASI
// =====================================================

const WHATSAPP_NUMBER = "905315006996";


// =====================================================
// GLOBAL
// =====================================================

const $ = id => document.getElementById(id);

let allProducts = [];
let currentCategory = "all";
let currentSearch = "";
let restaurantIsOpen = true;

// cart: { id: { id, name, price, quantity, note } }
let cart = {};


// =====================================================
// TOAST
// =====================================================

function showToast(message) {

    const toast = $("toast");

    if (!toast) return;

    toast.textContent = message;

    toast.classList.add("show");

    clearTimeout(window.customerToastTimer);

    window.customerToastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2000);
}


// =====================================================
// GÜVENLİ HTML
// =====================================================

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// =====================================================
// FİYAT FORMATI
// =====================================================

function formatPrice(value) {

    return Number(value || 0).toLocaleString("tr-TR") + "₺";
}


// =====================================================
// RESTORAN DURUMUNU DİNLE
// =====================================================

function listenRestaurantStatus() {

    if (!db) return;

    db.collection("settings")
        .doc("restaurant")
        .onSnapshot(

            snapshot => {

                const data = snapshot.exists ? snapshot.data() : {};

                restaurantIsOpen =
                    typeof data.isOpen === "boolean"
                        ? data.isOpen
                        : true;

                updateRestaurantStatusUI();
            },

            error => {
                console.error("❌ Restoran durumu okunamadı:", error);
            }
        );
}


function updateRestaurantStatusUI() {

    const statusEl = document.querySelector(".hero .status .open");

    const finishOrderBtn = $("finishOrder");

    if (statusEl) {

        if (restaurantIsOpen) {

            statusEl.textContent = "🟢 Şu Anda Açık";
            statusEl.classList.remove("closed");

        } else {

            statusEl.textContent = "🔴 Şu Anda Kapalı";
            statusEl.classList.add("closed");
        }
    }

    if (finishOrderBtn) {
        finishOrderBtn.disabled = !restaurantIsOpen;
    }
}


// =====================================================
// ÜRÜNLERİ DİNLE
// =====================================================

function listenProducts() {

    if (!db) return;

    const grid = $("menuGrid");

    if (!grid) return;

    grid.innerHTML = `
        <div class="menu-loading">
            Menü yükleniyor...
        </div>
    `;

    db.collection("products")
        .orderBy("name")
        .onSnapshot(

            snapshot => {

                allProducts = [];

                snapshot.forEach(doc => {

                    allProducts.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });

                renderProducts();
            },

            error => {

                console.error("❌ Ürünler yüklenemedi:", error);

                grid.innerHTML = `
                    <div class="menu-empty">
                        Menü şu anda yüklenemedi.
                    </div>
                `;
            }
        );
}


// =====================================================
// ÜRÜNLERİ FİLTRELE VE ÇİZ
// =====================================================

function renderProducts() {

    const grid = $("menuGrid");

    if (!grid) return;

    const search = currentSearch.trim().toLowerCase();

    const filtered = allProducts.filter(product => {

        const matchesCategory =
            currentCategory === "all" ||
            product.category === currentCategory;

        const matchesSearch =
            !search ||
            (product.name || "").toLowerCase().includes(search) ||
            (product.description || "").toLowerCase().includes(search);

        return matchesCategory && matchesSearch;
    });

    grid.innerHTML = "";

    if (!filtered.length) {

        grid.innerHTML = `
            <div class="menu-empty">
                Aradığın kriterlere uygun ürün bulunamadı.
            </div>
        `;

        return;
    }

    filtered.forEach(product => {
        grid.appendChild(createProductCard(product));
    });
}


// =====================================================
// ÜRÜN KARTI
// =====================================================

function createProductCard(product) {

    const available = product.available !== false;

    const image =
        product.imageData ||
        product.image ||
        product.imageUrl ||
        "";

    const price = Number(product.price || 0);

    const card = document.createElement("div");

    card.className = "menu-card";

    card.dataset.id = product.id;

    card.innerHTML = `

        <div class="menu-card-image">
            ${
                image
                    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">`
                    : `<div class="menu-card-placeholder">🍽️</div>`
            }
            ${
                !available
                    ? `<span class="menu-card-badge">Tükendi</span>`
                    : ""
            }
        </div>

        <div class="menu-card-info">

            <h3>${escapeHtml(product.name || "")}</h3>

            ${
                product.description
                    ? `<p>${escapeHtml(product.description)}</p>`
                    : ""
            }

            <div class="menu-card-bottom">

                <strong>${formatPrice(price)}</strong>

                <button
                    type="button"
                    class="add-to-cart-btn"
                    data-id="${escapeHtml(product.id)}"
                    ${available ? "" : "disabled"}
                >
                    ${available ? "➕ Sepete Ekle" : "Tükendi"}
                </button>

            </div>

        </div>
    `;

    return card;
}


// =====================================================
// KATEGORİ FİLTRESİ
// =====================================================

function setupCategoryFilter() {

    const buttons = document.querySelectorAll(".categories button");

    buttons.forEach(button => {

        button.addEventListener("click", () => {

            buttons.forEach(btn => btn.classList.remove("active"));

            button.classList.add("active");

            currentCategory = button.dataset.category || "all";

            renderProducts();
        });
    });
}


// =====================================================
// ARAMA
// =====================================================

function setupSearch() {

    const input = $("search");

    if (!input) return;

    input.addEventListener("input", event => {

        currentSearch = event.target.value || "";

        renderProducts();
    });
}


// =====================================================
// ANA BUTONLAR
// =====================================================

function setupHomeButtons() {

    const restaurantBtn = $("restaurantBtn");
    const packageBtn = $("packageBtn");
    const menuBtn = $("menuBtn");
    const menuSection = $("menu");

    const scrollToMenu = () => {
        if (menuSection) {
            menuSection.scrollIntoView({ behavior: "smooth" });
        }
    };

    if (restaurantBtn) {

        restaurantBtn.addEventListener("click", () => {

            const orderTypeSelect = $("orderType");

            if (orderTypeSelect) {
                orderTypeSelect.value = "Restoranda Sipariş";
            }

            scrollToMenu();
        });
    }

    if (packageBtn) {

        packageBtn.addEventListener("click", () => {

            const orderTypeSelect = $("orderType");

            if (orderTypeSelect) {
                orderTypeSelect.value = "Paket Sipariş";
            }

            scrollToMenu();
        });
    }

    if (menuBtn) {
        menuBtn.addEventListener("click", scrollToMenu);
    }
}


// =====================================================
// SEPET İŞLEMLERİ
// =====================================================

function addToCart(productId) {

    const product = allProducts.find(item => item.id === productId);

    if (!product) return;

    if (product.available === false) {

        showToast("Bu ürün şu anda satışta değil.");

        return;
    }

    if (cart[productId]) {

        cart[productId].quantity += 1;

    } else {

        cart[productId] = {
            id: productId,
            name: product.name || "",
            price: Number(product.price || 0),
            quantity: 1
        };
    }

    renderCart();

    showToast("Ürün Sepete Eklendi ✅");
}


function changeQuantity(productId, delta) {

    const item = cart[productId];

    if (!item) return;

    item.quantity += delta;

    if (item.quantity <= 0) {
        delete cart[productId];
    }

    renderCart();
}


function removeFromCart(productId) {

    delete cart[productId];

    renderCart();
}


function getCartTotal() {

    return Object.values(cart).reduce(
        (sum, item) => sum + (item.price * item.quantity),
        0
    );
}


function getCartCount() {

    return Object.values(cart).reduce(
        (sum, item) => sum + item.quantity,
        0
    );
}


function renderCart() {

    const cartCountEl = $("cartCount");
    const cartItemsEl = $("cartItems");
    const totalPriceEl = $("totalPrice");

    const items = Object.values(cart);

    if (cartCountEl) {
        cartCountEl.textContent = getCartCount();
    }

    if (totalPriceEl) {
        totalPriceEl.textContent = "Toplam: " + formatPrice(getCartTotal());
    }

    if (!cartItemsEl) return;

    cartItemsEl.innerHTML = "";

    if (!items.length) {

        cartItemsEl.innerHTML = `
            <li class="cart-empty">
                Sepetiniz boş.
            </li>
        `;

        return;
    }

    items.forEach(item => {

        const li = document.createElement("li");

        li.className = "cart-item";

        li.innerHTML = `

            <span class="cart-item-name">
                ${escapeHtml(item.name)}
            </span>

            <div class="cart-item-controls">

                <button
                    type="button"
                    class="qty-btn"
                    data-id="${escapeHtml(item.id)}"
                    data-delta="-1"
                >
                    −
                </button>

                <span class="cart-item-qty">
                    ${item.quantity}
                </span>

                <button
                    type="button"
                    class="qty-btn"
                    data-id="${escapeHtml(item.id)}"
                    data-delta="1"
                >
                    +
                </button>

            </div>

            <strong class="cart-item-price">
                ${formatPrice(item.price * item.quantity)}
            </strong>

            <button
                type="button"
                class="remove-item-btn"
                data-id="${escapeHtml(item.id)}"
                aria-label="Ürünü sepetten çıkar"
            >
                🗑️
            </button>
        `;

        cartItemsEl.appendChild(li);
    });
}


function setupCartEvents() {

    const grid = $("menuGrid");

    if (grid) {

        grid.addEventListener("click", event => {

            const addButton = event.target.closest(".add-to-cart-btn");

            if (addButton && !addButton.disabled) {
                addToCart(addButton.dataset.id);
            }
        });
    }

    const cartItemsEl = $("cartItems");

    if (cartItemsEl) {

        cartItemsEl.addEventListener("click", event => {

            const qtyButton = event.target.closest(".qty-btn");

            if (qtyButton) {

                changeQuantity(
                    qtyButton.dataset.id,
                    Number(qtyButton.dataset.delta)
                );

                return;
            }

            const removeButton = event.target.closest(".remove-item-btn");

            if (removeButton) {
                removeFromCart(removeButton.dataset.id);
            }
        });
    }
}


// =====================================================
// SİPARİŞ MODALI
// =====================================================

function openOrderModal() {

    if (!getCartCount()) {

        showToast("Sepetiniz boş.");

        return;
    }

    if (!restaurantIsOpen) {

        showToast("Restoran şu anda kapalı.");

        return;
    }

    renderOrderSummary();

    const modal = $("orderModal");

    if (modal) {

        modal.classList.add("show");

        document.body.style.overflow = "hidden";
    }
}


function closeOrderModal() {

    const modal = $("orderModal");

    if (!modal) return;

    modal.classList.remove("show");

    document.body.style.overflow = "";
}


function renderOrderSummary() {

    const summaryEl = $("orderSummaryItems");
    const totalEl = $("orderSummaryTotal");

    if (!summaryEl || !totalEl) return;

    const items = Object.values(cart);

    summaryEl.innerHTML = items.map(item => `
        <div class="order-summary-item">
            <span>${escapeHtml(item.name)} × ${item.quantity}</span>
            <strong>${formatPrice(item.price * item.quantity)}</strong>
        </div>
    `).join("");

    totalEl.textContent = "Toplam: " + formatPrice(getCartTotal());
}


function setupOrderModalEvents() {

    const finishOrderBtn = $("finishOrder");

    if (finishOrderBtn) {
        finishOrderBtn.addEventListener("click", openOrderModal);
    }

    const closeBtn = $("closeOrderModal");

    if (closeBtn) {
        closeBtn.addEventListener("click", closeOrderModal);
    }

    const modal = $("orderModal");

    if (modal) {

        modal.addEventListener("click", event => {

            if (event.target === modal) {
                closeOrderModal();
            }
        });
    }
}


// =====================================================
// SİPARİŞİ GÖNDER
// =====================================================

function buildWhatsAppMessage(orderData) {

    const lines = [];

    lines.push(`*ECE DÖNER — Yeni Sipariş*`);
    lines.push(``);
    lines.push(`👤 Ad Soyad: ${orderData.customerName}`);
    lines.push(`📱 Telefon: ${orderData.phone}`);
    lines.push(`📦 Sipariş Türü: ${orderData.orderType}`);

    if (orderData.tableNumber) {
        lines.push(`🪑 Masa No: ${orderData.tableNumber}`);
    }

    if (orderData.address) {
        lines.push(`📍 Adres: ${orderData.address}`);
    }

    lines.push(``);
    lines.push(`🛒 Sipariş Detayı:`);

    orderData.items.forEach(item => {
        lines.push(`• ${item.name} × ${item.quantity} — ${formatPrice(item.price * item.quantity)}`);
    });

    lines.push(``);
    lines.push(`💰 Toplam: ${formatPrice(orderData.total)}`);

    if (orderData.note) {
        lines.push(``);
        lines.push(`📝 Not: ${orderData.note}`);
    }

    return lines.join("\n");
}


async function submitOrder(event) {

    event.preventDefault();

    if (!getCartCount()) {

        showToast("Sepetiniz boş.");

        return;
    }

    const customerName = $("customerName")?.value.trim() || "";
    const phone = $("customerPhone")?.value.trim() || "";
    const orderType = $("orderType")?.value || "Paket Sipariş";
    const tableNumber = $("tableNumber")?.value.trim() || "";
    const address = $("orderAddress")?.value.trim() || "";
    const note = $("orderNote")?.value.trim() || "";

    if (!customerName || !phone) {

        showToast("Ad soyad ve telefon zorunlu.");

        return;
    }

    const items = Object.values(cart).map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity
    }));

    const total = getCartTotal();

    const orderData = {
        customerName,
        phone,
        orderType,
        tableNumber,
        address,
        note,
        items,
        total
    };

    const submitBtn = document.querySelector(".send-order-btn");

    if (submitBtn) {

        submitBtn.disabled = true;

        submitBtn.textContent = "⏳ Gönderiliyor...";
    }

    try {

        if (db) {

            await db.collection("orders").add({
                ...orderData,
                status: "new",
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        const message = buildWhatsAppMessage(orderData);

        const whatsappUrl =
            `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

        window.open(whatsappUrl, "_blank");

        cart = {};

        renderCart();

        closeOrderModal();

        $("orderForm")?.reset();

        showToast("Siparişiniz alındı ✅");

    } catch (error) {

        console.error("❌ Sipariş gönderilemedi:", error);

        showToast("Sipariş gönderilemedi, tekrar deneyin.");

    } finally {

        if (submitBtn) {

            submitBtn.disabled = false;

            submitBtn.textContent = "📲 WhatsApp'tan Sipariş Ver";
        }
    }
}


function setupOrderForm() {

    const form = $("orderForm");

    if (!form) return;

    form.addEventListener("submit", submitOrder);
}


// =====================================================
// BAŞLAT
// =====================================================

function initializeCustomerApp() {

    console.log("🚀 Ece Döner müşteri sayfası başlatılıyor...");

    listenRestaurantStatus();

    listenProducts();

    setupCategoryFilter();

    setupSearch();

    setupHomeButtons();

    setupCartEvents();

    setupOrderModalEvents();

    setupOrderForm();

    renderCart();
}


if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", initializeCustomerApp);

} else {

    initializeCustomerApp();
}
