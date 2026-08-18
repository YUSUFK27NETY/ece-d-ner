// ==========================================
// QR MENÜ PRO - ECE DÖNER
// FIREBASE ÜRÜN SİSTEMİ + RENDER SİPARİŞ SİSTEMİ
// ECE DÖNER QR MENÜ PRO
// MÜŞTERİ SAYFASI - TEMİZ SÜRÜM
// Firebase Ürünleri + Sepet + Sipariş
// ==========================================

"use strict";
@@ -31,13 +32,10 @@ try {
console.log("✅ Firebase bağlantısı hazır.");

} catch (error) {

    console.error(
        "❌ Firebase başlatılamadı:",
        error
    );
    console.error("❌ Firebase başlatılamadı:", error);
}


// ==========================================
// AYARLAR
// ==========================================
@@ -53,87 +51,99 @@ const ORDER_API_URL =
const WHATSAPP_NUMBER =
"905315006996";


// ==========================================
// GLOBAL DEĞİŞKENLER
// ==========================================

let cart = [];

let currentCategory = "all";

let isSendingOrder = false;

let cartItems;
let cartCount;
let totalPrice;
let finishOrderBtn;

let orderModal;
let closeOrderModal;
let orderForm;
let productsUnsubscribe = null;

let orderSummaryItems;
let orderSummaryTotal;
let cartItems = null;
let cartCount = null;
let totalPrice = null;
let finishOrderBtn = null;

let toast;
let searchInput;
let orderModal = null;
let closeOrderModal = null;
let orderForm = null;

let menuGrid;
let orderSummaryItems = null;
let orderSummaryTotal = null;

// Firebase listener
let productsUnsubscribe = null;
let toast = null;
let searchInput = null;
let menuGrid = null;


// ==========================================
// DOM ELEMANLARI
// DOM
// ==========================================

function cacheDom() {

cartItems =
        document.querySelector("#cartItems");
        document.getElementById("cartItems");

cartCount =
        document.querySelector("#cartCount");
        document.getElementById("cartCount");

totalPrice =
        document.querySelector("#totalPrice");
        document.getElementById("totalPrice");

finishOrderBtn =
        document.querySelector("#finishOrder");
        document.getElementById("finishOrder");

orderModal =
        document.querySelector("#orderModal");
        document.getElementById("orderModal");

closeOrderModal =
        document.querySelector("#closeOrderModal");
        document.getElementById("closeOrderModal");

orderForm =
        document.querySelector("#orderForm");
        document.getElementById("orderForm");

orderSummaryItems =
        document.querySelector(
            "#orderSummaryItems"
        );
        document.getElementById("orderSummaryItems");

orderSummaryTotal =
        document.querySelector(
            "#orderSummaryTotal"
        );
        document.getElementById("orderSummaryTotal");

toast =
        document.querySelector("#toast");
        document.getElementById("toast");

searchInput =
        document.querySelector("#search");
        document.getElementById("search");

menuGrid =
        document.querySelector("#menuGrid");
        document.getElementById("menuGrid");

    // Eğer ID eklenmediyse mevcut menu-grid'i bul
if (!menuGrid) {

menuGrid =
            document.querySelector(
                ".menu-grid"
            );
            document.querySelector(".menu-grid");
}

    console.log("✅ DOM elemanları hazır.");
}


// ==========================================
// GÜVENLİ HTML
// ==========================================

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


@@ -158,91 +168,21 @@ function showToast(

if (!toast) return;

    toast.textContent =
        message;
    toast.textContent = message;

    toast.classList.add(
        "show"
    );
    toast.classList.add("show");

    clearTimeout(
        window.toastTimer
    );
    clearTimeout(window.eceToastTimer);

    window.toastTimer =
    window.eceToastTimer =
setTimeout(() => {

            toast.classList.remove(
                "show"
            );
            toast.classList.remove("show");

}, 2200);
}


// ==========================================
// SEPET HESAPLARI
// ==========================================

function getCartTotal() {

    return cart.reduce(
        (total, item) => {

            return total +
                Number(item.price) *
                Number(item.quantity);

        },
        0
    );
}


function getCartCount() {

    return cart.reduce(
        (count, item) => {

            return count +
                Number(item.quantity);

        },
        0
    );
}


// ==========================================
// XSS KORUMASI
// ==========================================

function escapeHtml(value) {

    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


// ==========================================
// FAVORİLER
// ==========================================
@@ -251,15 +191,17 @@ function getFavorites() {

try {

        const saved =
        const data =
localStorage.getItem(
FAVORITES_KEY
);

        if (!saved) return [];
        if (!data) {
            return [];
        }

const parsed =
            JSON.parse(saved);
            JSON.parse(data);

return Array.isArray(parsed)
? parsed
@@ -268,7 +210,7 @@ function getFavorites() {
} catch (error) {

console.error(
            "Favoriler okunamadı:",
            "❌ Favoriler okunamadı:",
error
);

@@ -277,23 +219,19 @@ function getFavorites() {
}


function saveFavorites(
    favorites
) {
function saveFavorites(favorites) {

try {

localStorage.setItem(
FAVORITES_KEY,
            JSON.stringify(
                favorites
            )
            JSON.stringify(favorites)
);

} catch (error) {

console.error(
            "Favoriler kaydedilemedi:",
            "❌ Favoriler kaydedilemedi:",
error
);
}
@@ -302,144 +240,134 @@ function saveFavorites(

function setupFavorites() {

    const favorites =
        getFavorites();
    const buttons =
        document.querySelectorAll(
            ".menu-grid .favorite"
        );

    document
        .querySelectorAll(
            ".favorite"
        )
        .forEach(button => {

            const card =
                button.closest(
                    ".card"
                );
    buttons.forEach(button => {

            const productName =
                card
                    ?.querySelector("h3")
                    ?.textContent
                    .trim();
        if (button.dataset.favoriteReady === "true") {
            return;
        }

            if (!productName) return;
        button.dataset.favoriteReady = "true";

            const setState =
                active => {
        const card =
            button.closest(".card");

                    button.classList.toggle(
                        "active",
                        active
                    );
        if (!card) return;

                    button.textContent =
                        active
                            ? "❤️"
                            : "🤍";
                };
        const name =
            card.querySelector("h3")
                ?.textContent
                .trim();

            setState(
                favorites.includes(
                    productName
                )
        if (!name) return;

        function updateFavoriteUI(active) {

            button.classList.toggle(
                "active",
                active
);

            button.addEventListener(
                "click",
                () => {
            button.textContent =
                active ? "❤️" : "🤍";
        }

                    let current =
                        getFavorites();
        let favorites =
            getFavorites();

                    const active =
                        current.includes(
                            productName
                        );
        updateFavoriteUI(
            favorites.includes(name)
        );

                    if (active) {
        button.addEventListener(
            "click",
            () => {

                        current =
                            current.filter(
                                name =>
                                    name !==
                                    productName
                            );
                favorites =
                    getFavorites();

                const exists =
                    favorites.includes(name);

                        setState(false);
                if (exists) {

                        showToast(
                            "Favorilerden çıkarıldı"
                    favorites =
                        favorites.filter(
                            item =>
                                item !== name
);

                    } else {
                    updateFavoriteUI(false);

                        current.push(
                            productName
                        );
                    showToast(
                        "Favorilerden çıkarıldı"
                    );

                        setState(true);
                } else {

                        showToast(
                            "Favorilere eklendi ❤️"
                        );
                    }
                    favorites.push(name);

                    updateFavoriteUI(true);

                    saveFavorites(
                        current
                    showToast(
                        "Favorilere eklendi ❤️"
);
}
            );
        });

                saveFavorites(favorites);
            }
        );
    });
}


// ==========================================
// FIREBASE ÜRÜN VERİLERİNİ NORMALLEŞTİR
// KATEGORİ
// ==========================================

function normalizeCategory(
    category
) {
function normalizeCategory(category) {

const value =
        String(
            category || "all"
        )
        .trim()
        .toLocaleLowerCase(
            "tr-TR"
        );
        String(category || "")
            .trim()
            .toLocaleLowerCase("tr-TR");

if (
        value === "döner" ||
value === "doner" ||
        value === "döner" ||
value === "dönerler"
) {
return "doner";
}

if (
        value === "menü" ||
value === "menu" ||
        value === "menü" ||
value === "menüler" ||
value === "menuler"
) {
return "menu";
}

if (
        value === "drink" ||
value === "içecek" ||
        value === "icecek" ||
value === "içecekler" ||
        value === "icecek" ||
value === "icecekler"
) {
return "drink";
}

if (
        value === "dessert" ||
value === "tatlı" ||
        value === "tatli" ||
value === "tatlılar" ||
        value === "tatli" ||
value === "tatlilar"
) {
return "dessert";
@@ -450,7 +378,79 @@ function normalizeCategory(


// ==========================================
// FIREBASE ÜRÜN KARTI
// FOTOĞRAF URL'Sİ BUL
// ==========================================

function getProductImage(product) {

    const possibleImages = [

        product.image,

        product.imageUrl,

        product.imageURL,

        product.photo,

        product.photoURL,

        product.img,

        product.image_url

    ];

    for (const value of possibleImages) {

        if (
            typeof value === "string" &&
            value.trim() !== ""
        ) {

            return value.trim();
        }
    }

    return "";
}


// ==========================================
// FOTOĞRAF HATA YÖNETİMİ
// ==========================================

function handleImageError(img) {

    if (!img) return;

    console.error(
        "❌ Ürün fotoğrafı yüklenemedi:",
        img.src
    );

    img.onerror = null;

    const wrapper =
        img.closest(".product-image-wrapper");

    if (wrapper) {

        wrapper.innerHTML = `
            <div class="product-image-fallback">
                🍽️
            </div>
        `;

        return;
    }

    img.style.display = "none";
}


// ==========================================
// ÜRÜN KARTI
// ==========================================

function createProductCard(
@@ -478,18 +478,13 @@ function createProductCard(

const category =
normalizeCategory(
            product.category ||
            product.kategori ||
            product.category ??
            product.kategori ??
"all"
);

const image =
        product.image ||
        product.imageUrl ||
        product.imageURL ||
        product.photo ||
        product.photoURL ||
        "";
        getProductImage(product);

const discount =
Number(
@@ -499,19 +494,20 @@ function createProductCard(
);

const card =
        document.createElement(
            "div"
        );
        document.createElement("div");

    card.className =
        "card";
    card.className = "card";

card.dataset.category =
category;

card.dataset.productId =
documentId;

    // --------------------------------------
    // İNDİRİM
    // --------------------------------------

let badgeHTML = "";

if (
@@ -526,36 +522,57 @@ function createProductCard(
       `;
}

    // --------------------------------------
    // FOTOĞRAF
    // --------------------------------------

let imageHTML = "";

if (image) {

imageHTML = `
            <img
                src="${escapeHtml(image)}"
                alt="${escapeHtml(name)}"
                loading="lazy"
                onerror="this.style.display='none';"
            >
            <div class="product-image-wrapper">

                <img
                    src="${escapeHtml(image)}"
                    alt="${escapeHtml(name)}"
                    class="product-image"
                    loading="lazy"
                    onerror="handleImageError(this)"
                >

            </div>
       `;

        console.log(
            "🖼️ Fotoğraf bulundu:",
            name,
            image
        );

} else {

        console.warn(
            "⚠️ Bu üründe fotoğraf URL'si yok:",
            name,
            product
        );

imageHTML = `
            <div style="
                width:100%;
                height:180px;
                display:flex;
                align-items:center;
                justify-content:center;
                background:#222;
                font-size:55px;
            ">
                🍽️
            <div class="product-image-wrapper">

                <div class="product-image-fallback">
                    🍽️
                </div>

           </div>
       `;
}

    // --------------------------------------
    // KART
    // --------------------------------------

card.innerHTML = `

       ${badgeHTML}
@@ -605,15 +622,19 @@ function createProductCard(


// ==========================================
// FIREBASE'DEN ÜRÜNLERİ OKU
// FIREBASE ÜRÜNLERİ
// ==========================================

function loadProductsFromFirebase() {

if (!db) {

console.error(
            "❌ Firebase bağlantısı yok."
            "❌ Firestore bağlantısı yok."
        );

        showFirebaseError(
            "Firebase bağlantısı kurulamadı."
);

return;
@@ -622,7 +643,7 @@ function loadProductsFromFirebase() {
if (!menuGrid) {

console.error(
            "❌ menuGrid bulunamadı."
            "❌ Menü alanı bulunamadı."
);

return;
@@ -632,148 +653,212 @@ function loadProductsFromFirebase() {
"🔥 Firebase ürünleri dinleniyor..."
);

    try {
    if (productsUnsubscribe) {

        productsUnsubscribe =
            db
                .collection("products")
                .onSnapshot(
                    snapshot => {
        productsUnsubscribe();

                        console.log(
                            `🔥 ${snapshot.size} ürün Firebase'den geldi.`
                        );
        productsUnsubscribe = null;
    }

                        menuGrid.innerHTML =
                            "";
    productsUnsubscribe =
        db.collection("products")
            .onSnapshot(

                        if (
                            snapshot.empty
                        ) {
                snapshot => {

                    console.log(
                        `🔥 Firebase'den ${snapshot.size} ürün geldi.`
                    );

                    menuGrid.innerHTML = "";

                    if (snapshot.empty) {

                        menuGrid.innerHTML = `

                            <div style="
                                grid-column:1/-1;
                                text-align:center;
                                padding:50px 20px;
                            ">

                            menuGrid.innerHTML = `
                               <div style="
                                    grid-column:1/-1;
                                    text-align:center;
                                    padding:40px 20px;
                                    color:#888;
                                    font-size:55px;
                                    margin-bottom:15px;
                               ">
                                    <div style="
                                        font-size:45px;
                                        margin-bottom:10px;
                                    ">
                                        🍽️
                                    </div>

                                    <h3 style="
                                        color:#bbb;
                                        margin-bottom:8px;
                                    ">
                                        Henüz ürün bulunmuyor
                                    </h3>

                                    <p>
                                        Admin panelinden ürün ekleyebilirsiniz.
                                    </p>
                                    🍽️
                               </div>
                            `;

                            return;
                        }
                                <h3>
                                    Henüz ürün bulunmuyor
                                </h3>

                        snapshot.forEach(
                            doc => {

                                const product =
                                    doc.data();

                                // Aktiflik kontrolü
                                // active false ise gösterme
                                if (
                                    product.active === false ||
                                    product.aktif === false
                                ) {
                                    return;
                                }

                                const card =
                                    createProductCard(
                                        product,
                                        doc.id
                                    );

                                menuGrid.appendChild(
                                    card
                                );
                            }
                        );
                                <p>
                                    Admin panelinden ürün ekleyebilirsiniz.
                                </p>

                        // Dinamik ürünler oluşturulduktan
                        // sonra eventleri tekrar kur
                        setupFavorites();
                            </div>

                        filterProducts();
                        `;

                        console.log(
                            "✅ Firebase ürünleri menüye aktarıldı."
                        );
                    },
                        return;
                    }

                    error => {
                    let visibleCount = 0;

                        console.error(
                            "❌ Firebase ürünleri okunamadı:",
                            error
                        );
                    snapshot.forEach(doc => {

                        const product =
                            doc.data();

                        // ----------------------------------
                        // AKTİF ÜRÜN KONTROLÜ
                        // ----------------------------------

                        if (
                            product.active === false ||
                            product.aktif === false ||
                            product.available === false
                        ) {

                            return;
                        }

                        const card =
                            createProductCard(
                                product,
                                doc.id
                            );

                        menuGrid.appendChild(card);

                        visibleCount++;
                    });

                    if (visibleCount === 0) {

menuGrid.innerHTML = `

                           <div style="
                               grid-column:1/-1;
                               text-align:center;
                                padding:40px 20px;
                                color:#ff6b6b;
                                padding:50px 20px;
                           ">

                               <div style="
                                    font-size:45px;
                                    margin-bottom:10px;
                                    font-size:50px;
                               ">
                                    ⚠️
                                    😕
                               </div>

                               <h3>
                                    Ürünler yüklenemedi
                                    Şu anda gösterilecek ürün yok.
                               </h3>

                                <p style="
                                    margin-top:8px;
                                    color:#aaa;
                                ">
                                    Firebase bağlantısını veya
                                    Firestore kurallarını kontrol edin.
                                </p>
                           </div>

                       `;
}
                );

    } catch (error) {
                    setupFavorites();

        console.error(
            "❌ Firebase ürün sistemi hatası:",
            error
        );
    }
                    filterProducts();

                    console.log(
                        "✅ Ürünler müşteri sayfasına aktarıldı."
                    );
                },

                error => {

                    console.error(
                        "❌ Firestore ürün hatası:",
                        error
                    );

                    showFirebaseError(
                        "Ürünler yüklenemedi. Firebase bağlantısını kontrol edin."
                    );
                }
            );
}


// ==========================================
// FIREBASE HATA MESAJI
// ==========================================

function showFirebaseError(message) {

    if (!menuGrid) return;

    menuGrid.innerHTML = `

        <div style="
            grid-column:1/-1;
            text-align:center;
            padding:50px 20px;
            color:#ff6b6b;
        ">

            <div style="
                font-size:50px;
                margin-bottom:15px;
            ">
                ⚠️
            </div>

            <h3>
                ${escapeHtml(message)}
            </h3>

            <p style="
                margin-top:10px;
                color:#999;
            ">
                Sayfayı yenileyip tekrar deneyin.
            </p>

        </div>

    `;
}


// ==========================================
// SEPET
// ==========================================

function addToCart(
    name,
    price
) {
function getCartTotal() {

    return cart.reduce(
        (total, item) => {

            return total +
                Number(item.price) *
                Number(item.quantity);

        },
        0
    );
}


function getCartCount() {

    return cart.reduce(
        (total, item) => {

            return total +
                Number(item.quantity);

        },
        0
    );
}


function addToCart(name, price) {

const existing =
cart.find(
@@ -783,14 +868,20 @@ function addToCart(

if (existing) {

        existing.quantity += 1;
        existing.quantity++;

} else {

cart.push({
            name,
            price: Number(price),
            quantity: 1

            name:
                String(name),

            price:
                Number(price),

            quantity:
                1
});
}

@@ -802,10 +893,7 @@ function addToCart(
}


function changeQty(
    index,
    delta
) {
function changeQty(index, delta) {

if (
index < 0 ||
@@ -814,26 +902,20 @@ function changeQty(
return;
}

    cart[index].quantity +=
        delta;
    cart[index].quantity += delta;

if (
cart[index].quantity <= 0
) {

        cart.splice(
            index,
            1
        );
        cart.splice(index, 1);
}

updateCart();
}


function removeFromCart(
    index
) {
function removeFromCart(index) {

if (
index < 0 ||
@@ -842,79 +924,73 @@ function removeFromCart(
return;
}

    const removed =
    const name =
cart[index].name;

    cart.splice(
        index,
        1
    );
    cart.splice(index, 1);

updateCart();

showToast(
        `${removed} sepetten çıkarıldı`
        `${name} sepetten çıkarıldı`
);
}


// ==========================================
// SEPETİ GÜNCELLE
// ==========================================

function updateCart() {

if (cartItems) {

        cartItems.innerHTML =
            "";
        cartItems.innerHTML = "";

if (!cart.length) {

            const li =
                document.createElement(
                    "li"
                );
            cartItems.innerHTML = `

            li.innerHTML = `
                <div style="
                    text-align:center;
                    padding:20px 10px;
                    color:#888;
                ">
                    🛒 Sepetiniz şu anda boş.
                </div>
            `;
                <li>

            cartItems.appendChild(
                li
            );
                    <div style="
                        text-align:center;
                        padding:20px;
                        color:#888;
                    ">
                        🛒 Sepetiniz şu anda boş.
                    </div>

                </li>

            `;

} else {

cart.forEach(
(item, index) => {

const li =
                        document.createElement(
                            "li"
                        );
                        document.createElement("li");

li.innerHTML = `

                       <div class="cart-item">

                           <div>

                               <strong>
                                    ${escapeHtml(
                                        item.name
                                    )}
                                    ${escapeHtml(item.name)}
                               </strong>

                               <br>

                               <span>
                                    ${formatPrice(
                                        item.price
                                    )}
                                    ${formatPrice(item.price)}
                                   ×
                                   ${item.quantity}
                               </span>

                           </div>

                           <div class="cart-controls">
@@ -954,9 +1030,7 @@ function updateCart() {
                       </div>
                   `;

                    cartItems.appendChild(
                        li
                    );
                    cartItems.appendChild(li);
}
);
}
@@ -971,9 +1045,7 @@ function updateCart() {
if (totalPrice) {

totalPrice.textContent =
            `Toplam: ${formatPrice(
                getCartTotal()
            )}`;
            `Toplam: ${formatPrice(getCartTotal())}`;
}

if (finishOrderBtn) {
@@ -1004,35 +1076,25 @@ function setupCartEvents() {
event => {

const qty =
                event.target.closest(
                    ".qty-btn"
                );
                event.target.closest(".qty-btn");

if (qty) {

changeQty(
                    Number(
                        qty.dataset.index
                    ),
                    Number(
                        qty.dataset.delta
                    )
                    Number(qty.dataset.index),
                    Number(qty.dataset.delta)
);

return;
}

const del =
                event.target.closest(
                    ".delete-btn"
                );
                event.target.closest(".delete-btn");

if (del) {

removeFromCart(
                    Number(
                        del.dataset.delete
                    )
                    Number(del.dataset.delete)
);
}
}
@@ -1041,35 +1103,27 @@ function setupCartEvents() {


// ==========================================
// DİNAMİK SEPETE EKLE
// SEPETE EKLE
// ==========================================

function setupAddCartButtons() {

if (!menuGrid) return;

    // Event delegation
    // Firebase'den sonradan gelen ürünler
    // de otomatik çalışır.

menuGrid.addEventListener(
"click",
event => {

const button =
                event.target.closest(
                    ".addCart"
                );
                event.target.closest(".addCart");

if (!button) return;

const name =
button.dataset.name;

const price =
                Number(
                    button.dataset.price
                );
                Number(button.dataset.price);

if (
!name ||
@@ -1093,7 +1147,7 @@ function setupAddCartButtons() {


// ==========================================
// KATEGORİ + ARAMA
// FİLTRE
// ==========================================

function filterProducts() {
@@ -1102,56 +1156,41 @@ function filterProducts() {
searchInput
? searchInput.value
.trim()
                .toLocaleLowerCase(
                    "tr-TR"
                )
                .toLocaleLowerCase("tr-TR")
: "";

document
        .querySelectorAll(
            ".menu-grid .card"
        )
        .querySelectorAll(".menu-grid .card")
.forEach(card => {

const category =
                card.dataset.category ||
                "";
                card.dataset.category || "";

const name =
                card
                    .querySelector("h3")
                card.querySelector("h3")
?.textContent
.trim()
                    .toLocaleLowerCase(
                        "tr-TR"
                    ) || "";
                    .toLocaleLowerCase("tr-TR")
                    || "";

const description =
                card
                    .querySelector("p")
                card.querySelector("p")
?.textContent
.trim()
                    .toLocaleLowerCase(
                        "tr-TR"
                    ) || "";
                    .toLocaleLowerCase("tr-TR")
                    || "";

const categoryMatch =
currentCategory === "all" ||
                category ===
                    currentCategory;
                category === currentCategory;

const searchMatch =
!searchTerm ||
                name.includes(
                    searchTerm
                ) ||
                description.includes(
                    searchTerm
                );
                name.includes(searchTerm) ||
                description.includes(searchTerm);

card.style.display =
                categoryMatch &&
                searchMatch
                categoryMatch && searchMatch
? ""
: "none";
});
@@ -1165,45 +1204,42 @@ function setupCategories() {
".categories [data-category]"
);

    buttons.forEach(
        button => {
    buttons.forEach(button => {

            button.addEventListener(
                "click",
                () => {
        button.addEventListener(
            "click",
            () => {

                    const category =
                        button.dataset.category;
                const category =
                    button.dataset.category;

                    if (!category)
                        return;
                if (!category) return;

                    currentCategory =
                        category;
                currentCategory =
                    category;

                    buttons.forEach(
                        btn =>
                            btn.classList.remove(
                                "active"
                            )
                    );
                buttons.forEach(btn => {

                    button.classList.add(
                    btn.classList.remove(
"active"
);

                    filterProducts();
                }
            );
        }
    );
                });

                button.classList.add(
                    "active"
                );

                filterProducts();
            }
        );
    });
}


function setupSearch() {

    if (!searchInput)
        return;
    if (!searchInput) return;

searchInput.addEventListener(
"input",
@@ -1213,45 +1249,31 @@ function setupSearch() {


// ==========================================
// SİPARİŞ TÜRÜ
// MODAL
// ==========================================

function setOrderType(
    type
) {
function setOrderType(type) {

const select =
        document.querySelector(
            "#orderType"
        );
        document.getElementById("orderType");

    if (!select)
        return;
    if (!select) return;

const exists =
        Array.from(
            select.options
        ).some(
            option =>
                option.value ===
                type
        );
        Array.from(select.options)
            .some(
                option =>
                    option.value === type
            );

if (exists) {

        select.value =
            type;
        select.value = type;
}
}


// ==========================================
// SİPARİŞ MODALI
// ==========================================

function openOrderModal(
    orderType = null
) {
function openOrderModal(orderType = null) {

if (!cart.length) {

@@ -1262,21 +1284,16 @@ function openOrderModal(
return;
}

    if (!orderModal)
        return;
    if (!orderModal) return;

if (orderType) {

        setOrderType(
            orderType
        );
        setOrderType(orderType);
}

updateOrderSummary();

    orderModal.classList.add(
        "show"
    );
    orderModal.classList.add("show");

document.body.style.overflow =
"hidden";
@@ -1285,83 +1302,73 @@ function openOrderModal(

function closeModal() {

    if (!orderModal)
        return;
    if (!orderModal) return;

    orderModal.classList.remove(
        "show"
    );
    orderModal.classList.remove("show");

    document.body.style.overflow =
        "";
    document.body.style.overflow = "";
}


// ==========================================
// SİPARİŞ ÖZETİ
// ==========================================

function updateOrderSummary() {

    if (!orderSummaryItems)
        return;
    if (!orderSummaryItems) return;

    orderSummaryItems.innerHTML =
        "";
    orderSummaryItems.innerHTML = "";

if (!cart.length) {

orderSummaryItems.innerHTML = `

           <div style="
                color:#888;
               text-align:center;
                color:#888;
               padding:10px;
           ">
               Sepet boş
           </div>

       `;

} else {

        cart.forEach(
            item => {
        cart.forEach(item => {

                const row =
                    document.createElement(
                        "div"
                    );
            const row =
                document.createElement("div");

                row.className =
                    "summary-item";

                const itemTotal =
                    Number(item.price) *
                    Number(item.quantity);

                row.innerHTML = `
                    <span>
                        ${escapeHtml(
                            item.name
                        )}
                        × ${item.quantity}
                    </span>

                    <strong>
                        ${formatPrice(
                            itemTotal
                        )}
                    </strong>
                `;

                orderSummaryItems.appendChild(
                    row
                );
            }
        );
            row.className =
                "summary-item";

            const itemTotal =
                Number(item.price) *
                Number(item.quantity);

            row.innerHTML = `

                <span>
                    ${escapeHtml(item.name)}
                    × ${item.quantity}
                </span>

                <strong>
                    ${formatPrice(itemTotal)}
                </strong>

            `;

            orderSummaryItems.appendChild(row);
        });
}

if (orderSummaryTotal) {

orderSummaryTotal.textContent =
            `Toplam: ${formatPrice(
                getCartTotal()
            )}`;
            `Toplam: ${formatPrice(getCartTotal())}`;
}
}

@@ -1373,9 +1380,7 @@ function updateOrderSummary() {
function setupModal() {

const menuBtn =
        document.querySelector(
            "#menuBtn"
        );
        document.getElementById("menuBtn");

if (menuBtn) {

@@ -1384,28 +1389,22 @@ function setupModal() {
() => {

const menu =
                    document.querySelector(
                        "#menu"
                    );
                    document.getElementById("menu");

if (menu) {

menu.scrollIntoView({
                        behavior:
                            "smooth",

                        block:
                            "start"
                        behavior: "smooth",
                        block: "start"
});
}
}
);
}


const packageBtn =
        document.querySelector(
            "#packageBtn"
        );
        document.getElementById("packageBtn");

if (packageBtn) {

@@ -1418,10 +1417,9 @@ function setupModal() {
);
}


const restaurantBtn =
        document.querySelector(
            "#restaurantBtn"
        );
        document.getElementById("restaurantBtn");

if (restaurantBtn) {

@@ -1434,6 +1432,7 @@ function setupModal() {
);
}


if (finishOrderBtn) {

finishOrderBtn.addEventListener(
@@ -1443,6 +1442,7 @@ function setupModal() {
);
}


if (closeOrderModal) {

closeOrderModal.addEventListener(
@@ -1451,15 +1451,15 @@ function setupModal() {
);
}


if (orderModal) {

orderModal.addEventListener(
"click",
event => {

if (
                    event.target ===
                    orderModal
                    event.target === orderModal
) {

closeModal();
@@ -1468,17 +1468,15 @@ function setupModal() {
);
}


document.addEventListener(
"keydown",
event => {

if (
                event.key ===
                    "Escape" &&
                event.key === "Escape" &&
orderModal &&
                orderModal.classList.contains(
                    "show"
                )
                orderModal.classList.contains("show")
) {

closeModal();
@@ -1492,42 +1490,27 @@ function setupModal() {
// TELEFON
// ==========================================

function normalizePhone(
    phone
) {
function normalizePhone(phone) {

    return String(
        phone || ""
    )
        .replace(
            /\D/g,
            ""
        );
    return String(phone || "")
        .replace(/\D/g, "");
}


function isValidTurkishPhone(
    phone
) {
function isValidTurkishPhone(phone) {

const normalized =
        normalizePhone(
            phone
        );
        normalizePhone(phone);

return (
        /^05\d{9}$/.test(
            normalized
        ) ||
        /^5\d{9}$/.test(
            normalized
        )
        /^05\d{9}$/.test(normalized) ||
        /^5\d{9}$/.test(normalized)
);
}


// ==========================================
// WHATSAPP
// WHATSAPP MESAJI
// ==========================================

function createWhatsAppMessage(
@@ -1539,9 +1522,6 @@ function createWhatsAppMessage(
note
) {

    const total =
        getCartTotal();

let message =
"🍽️ *ECE DÖNER SİPARİŞİ*";

@@ -1578,21 +1558,19 @@ function createWhatsAppMessage(
"\n\n🛒 *SİPARİŞLER*" +
"\n━━━━━━━━━━━━━━";

    cart.forEach(
        item => {
    cart.forEach(item => {

            const itemTotal =
                Number(item.price) *
                Number(item.quantity);
        const itemTotal =
            Number(item.price) *
            Number(item.quantity);

            message +=
                `\n• ${item.name} × ${item.quantity} = ${formatPrice(itemTotal)}`;
        }
    );
        message +=
            `\n• ${item.name} × ${item.quantity} = ${formatPrice(itemTotal)}`;
    });

message +=
"\n\n💰 *TOPLAM: " +
        formatPrice(total) +
        formatPrice(getCartTotal()) +
"*";

if (note) {
@@ -1610,17 +1588,17 @@ function createWhatsAppMessage(
}


function openWhatsApp(
    message
) {
// ==========================================
// WHATSAPP
// ==========================================

function openWhatsApp(message) {

const url =
"https://api.whatsapp.com/send?phone=" +
WHATSAPP_NUMBER +
"&text=" +
        encodeURIComponent(
            message
        );
        encodeURIComponent(message);

window.open(
url,
@@ -1631,40 +1609,35 @@ function openWhatsApp(


// ==========================================
// RENDER BACKEND
// BACKEND
// ==========================================

async function sendOrderToBackend(
    orderData
) {
async function sendOrderToBackend(orderData) {

const response =
await fetch(
ORDER_API_URL,
{
                method:
                    "POST",
                method: "POST",

headers: {
"Content-Type":
"application/json"
},

body:
                    JSON.stringify(
                        orderData
                    )
                    JSON.stringify(orderData)
}
);

    let result;
    let result = null;

try {

result =
await response.json();

    } catch (error) {
    } catch {

throw new Error(
"Sunucudan geçersiz cevap geldi."
@@ -1692,17 +1665,15 @@ async function sendOrderToBackend(

function setupOrderForm() {

    if (!orderForm)
        return;
    if (!orderForm) return;

orderForm.addEventListener(
"submit",
async event => {

event.preventDefault();

            if (isSendingOrder)
                return;
            if (isSendingOrder) return;

if (!cart.length) {

@@ -1717,56 +1688,42 @@ function setupOrderForm() {

const customerName =
document
                    .querySelector(
                        "#customerName"
                    )
                    .getElementById("customerName")
?.value
.trim() || "";

const customerPhone =
document
                    .querySelector(
                        "#customerPhone"
                    )
                    .getElementById("customerPhone")
?.value
.trim() || "";

const orderType =
document
                    .querySelector(
                        "#orderType"
                    )
                    .getElementById("orderType")
?.value ||
"Paket Sipariş";

const tableNumber =
document
                    .querySelector(
                        "#tableNumber"
                    )
                    .getElementById("tableNumber")
?.value
.trim() || "";

const address =
document
                    .querySelector(
                        "#orderAddress"
                    )
                    .getElementById("orderAddress")
?.value
.trim() || "";

const note =
document
                    .querySelector(
                        "#orderNote"
                    )
                    .getElementById("orderNote")
?.value
.trim() || "";

            if (
                customerName.length <
                2
            ) {

            if (customerName.length < 2) {

showToast(
"Lütfen adınızı ve soyadınızı girin."
@@ -1775,22 +1732,23 @@ function setupOrderForm() {
return;
}


if (
!isValidTurkishPhone(
customerPhone
)
) {

showToast(
                    "Lütfen geçerli bir telefon numarası girin."
                    "Geçerli bir telefon numarası girin."
);

return;
}


if (
                orderType ===
                    "Paket Sipariş" &&
                orderType === "Paket Sipariş" &&
!address
) {

@@ -1801,39 +1759,34 @@ function setupOrderForm() {
return;
}


if (
                orderType ===
                    "Restoranda Sipariş" &&
                orderType === "Restoranda Sipariş" &&
!tableNumber
) {

showToast(
                    "Restoran siparişi için masa numarasını girin 🪑"
                    "Restoran siparişi için masa numarası gerekli 🪑"
);

return;
}


const items =
                cart.map(
                    item => ({

                        name:
                            String(
                                item.name
                            ),

                        price:
                            Number(
                                item.price
                            ),

                        quantity:
                            Number(
                                item.quantity
                            )
                    })
                );
                cart.map(item => ({

                    name:
                        String(item.name),

                    price:
                        Number(item.price),

                    quantity:
                        Number(item.quantity)

                }));


const orderData = {

@@ -1861,27 +1814,27 @@ function setupOrderForm() {
"new",

createdAt:
                    new Date()
                        .toISOString()
                    new Date().toISOString()
};

            isSendingOrder =
                true;

            isSendingOrder = true;


const submitButton =
orderForm.querySelector(
'button[type="submit"]'
);


const originalText =
                submitButton
                    ?.textContent ||
                "";
                submitButton?.textContent ||
                "📲 WhatsApp'tan Sipariş Ver";


if (submitButton) {

                submitButton.disabled =
                    true;
                submitButton.disabled = true;

submitButton.textContent =
"⏳ Sipariş Gönderiliyor...";
@@ -1890,12 +1843,14 @@ function setupOrderForm() {
"0.7";
}


try {

await sendOrderToBackend(
orderData
);


const message =
createWhatsAppMessage(
customerName,
@@ -1906,14 +1861,15 @@ function setupOrderForm() {
note
);

                openWhatsApp(
                    message
                );

                openWhatsApp(message);


showToast(
"Siparişiniz başarıyla alındı! ✅"
);


cart = [];

updateCart();
@@ -1922,30 +1878,29 @@ function setupOrderForm() {

closeModal();


} catch (error) {

console.error(
                    "Sipariş gönderme hatası:",
                    "❌ Sipariş gönderme hatası:",
error
);

showToast(
                    "Sipariş gönderilemedi. Lütfen tekrar deneyin. ❌"
                    "Sipariş gönderilemedi. Tekrar deneyin. ❌"
);


} finally {

                isSendingOrder =
                    false;
                isSendingOrder = false;

if (submitButton) {

                    submitButton.disabled =
                        false;
                    submitButton.disabled = false;

submitButton.textContent =
                        originalText ||
                        "📲 WhatsApp'tan Sipariş Ver";
                        originalText;

submitButton.style.opacity =
"1";
@@ -1957,7 +1912,7 @@ function setupOrderForm() {


// ==========================================
// BAŞLANGIÇ
// BAŞLAT
// ==========================================

function initializeApp() {
@@ -1978,33 +1933,44 @@ function initializeApp() {

updateCart();

    // Önce mevcut HTML ürünlerine
    // event bağlanabilir.
setupFavorites();

filterProducts();

    // 🔥 ASIL YENİ SİSTEM
loadProductsFromFirebase();

console.log(
        "✅ Ece Döner QR Menü Pro hazır."
        "================================"
);

console.log(
        "✅ Sipariş API:",
        ORDER_API_URL
        "✅ ECE DÖNER QR MENÜ PRO HAZIR"
    );

    console.log(
        "🔥 Firebase ürün sistemi aktif"
    );

    console.log(
        "🛒 Sepet sistemi aktif"
    );

    console.log(
        "📦 Sipariş sistemi aktif"
    );

    console.log(
        "================================"
);
}


// ==========================================
// UYGULAMAYI BAŞLAT
// BAŞLAT
// ==========================================

if (
    document.readyState ===
    "loading"
    document.readyState === "loading"
) {

document.addEventListener(
@@ -2033,3 +1999,7 @@ window.openOrderModal =

window.closeModal =
closeModal;

window.handleImageError =
    handleImageError;
