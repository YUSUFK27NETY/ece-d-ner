// ==========================================
// QR MENÜ PRO - ECE DÖNER - FİREBASE SÜRÜMÜ
// ==========================================
"use strict";

const firebaseConfig = {
  apiKey: "AIzaSyCfPqMm1Azo6ZS9ee4NNd1y-bFzPv9JaCU",
  authDomain: "ece-2e44c.firebaseapp.com",
  projectId: "ece-2e44c",
  storageBucket: "ece-2e44c.firebasestorage.app",
  messagingSenderId: "937356035748",
  appId: "1:937356035748:web:6c8f79c774f4c3c64b0831",
  measurementId: "G-9VEVNMW5T0"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let cart = [];
const orderForm = document.querySelector("#orderForm");
const orderModal = document.querySelector("#orderModal");

// SEPETİ GÜNCELLE
function updateCart() {
    const cartItems = document.querySelector("#cartItems");
    const cartCount = document.querySelector("#cartCount");
    const totalPrice = document.querySelector("#totalPrice");
    if (!cartItems) return;
    cartItems.innerHTML = "";
    let total = 0;
    cart.forEach((item, index) => {
        total += item.price * item.quantity;
        const li = document.createElement("li");
        li.innerHTML = `<div><strong>${item.name}</strong><br><span>${item.price}₺ × ${item.quantity}</span></div>
                        <button onclick="changeQty(${index}, -1)">-</button><span>${item.quantity}</span><button onclick="changeQty(${index}, 1)">+</button>`;
        cartItems.appendChild(li);
    });
    if (totalPrice) totalPrice.innerText = "Toplam: " + total + "₺";
}

function changeQty(index, delta) {
    cart[index].quantity += delta;
    if (cart[index].quantity <= 0) cart.splice(index, 1);
    updateCart();
}

// SİPARİŞİ GÖNDER
if (orderForm) {
    orderForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const customerName = document.querySelector("#customerName").value;
        const customerPhone = document.querySelector("#customerPhone").value;

        try {
            await db.collection("orders").add({
                customerName,
                phone: customerPhone,
                items: cart,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            let msg = "Sipariş: " + customerName + " - " + customerPhone;
            window.open("https://api.whatsapp.com/send?phone=905315006996&text=" + encodeURIComponent(msg));
            
            alert("Sipariş alındı!");
            cart = [];
            updateCart();
            orderForm.reset();
            if (orderModal) orderModal.style.display = "none";
        } catch (err) {
            alert("Hata oluştu: " + err.message);
        }
    });
}

// SEPETE EKLE
document.querySelectorAll(".addCart").forEach(btn => {
    btn.addEventListener("click", () => {
        cart.push({ name: btn.dataset.name, price: Number(btn.dataset.price), quantity: 1 });
        updateCart();
        alert("Eklendi!");
    });
});
