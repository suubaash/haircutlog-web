import { firebaseConfig, googlePlacesApiKey, cloudinaryConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let entries = [];
let unsubscribeEntries = null;
let pendingPhotoFile = null;

const el = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el(`screen-${name}`).classList.add("active");
  document.querySelectorAll(".tab-button").forEach((b) => {
    b.classList.toggle("active", b.dataset.screen === name);
  });
}

document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    showScreen(btn.dataset.screen);
    if (btn.dataset.screen === "salons") {
      loadNearbySalons();
    }
  });
});

// ---------- Auth ----------

el("btn-sign-in").addEventListener("click", async () => {
  el("auth-error").textContent = "";
  setButtonLoading(el("btn-sign-in"), true, "Signing In…");
  try {
    await signInWithEmailAndPassword(auth, el("auth-email").value.trim(), el("auth-password").value);
  } catch (error) {
    el("auth-error").textContent = error.message;
  }
  setButtonLoading(el("btn-sign-in"), false, "Sign In");
});

el("btn-sign-up").addEventListener("click", async () => {
  el("auth-error").textContent = "";
  try {
    await createUserWithEmailAndPassword(auth, el("auth-email").value.trim(), el("auth-password").value);
  } catch (error) {
    el("auth-error").textContent = error.message;
  }
});

function setButtonLoading(button, isLoading, label) {
  button.disabled = isLoading;
  button.textContent = label;
}

el("btn-google-signin").addEventListener("click", async () => {
  el("auth-error").textContent = "";
  const nativeBridge = window.webkit?.messageHandlers?.googleSignIn;
  if (nativeBridge) {
    nativeBridge.postMessage("signIn");
    return;
  }
  try {
    await signInWithRedirect(auth, new GoogleAuthProvider());
  } catch (error) {
    el("auth-error").textContent = error.message;
  }
});

// Called by native Swift code after a successful native Google sign-in.
window.completeGoogleSignIn = async (idToken) => {
  el("auth-error").textContent = "";
  try {
    const credential = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(auth, credential);
  } catch (error) {
    el("auth-error").textContent = error.message;
  }
};

window.reportGoogleSignInError = (message) => {
  el("auth-error").textContent = message;
};

el("btn-apple-signin").addEventListener("click", async () => {
  el("auth-error").textContent = "";
  const nativeBridge = window.webkit?.messageHandlers?.appleSignIn;
  if (nativeBridge) {
    nativeBridge.postMessage("signIn");
    return;
  }
  try {
    await signInWithRedirect(auth, new OAuthProvider("apple.com"));
  } catch (error) {
    el("auth-error").textContent = error.message;
  }
});

// Called by native Swift code after a successful native Sign in with Apple.
window.completeAppleSignIn = async (identityToken, rawNonce) => {
  el("auth-error").textContent = "";
  try {
    const provider = new OAuthProvider("apple.com");
    const credential = provider.credential({ idToken: identityToken, rawNonce });
    await signInWithCredential(auth, credential);
  } catch (error) {
    el("auth-error").textContent = error.message;
  }
};

window.reportAppleSignInError = (message) => {
  el("auth-error").textContent = message;
};

getRedirectResult(auth).catch((error) => {
  el("auth-error").textContent = error.message;
});

// ---------- Account ----------

el("btn-account").addEventListener("click", () => {
  el("account-email").textContent = currentUser?.email || "";
  el("account-error").textContent = "";
  el("modal-account").classList.add("active");
});

el("btn-close-account").addEventListener("click", () => {
  el("modal-account").classList.remove("active");
});

el("btn-sign-out").addEventListener("click", async () => {
  await signOut(auth);
  el("modal-account").classList.remove("active");
});

el("btn-delete-account").addEventListener("click", () => {
  el("modal-account").classList.remove("active");
  el("modal-delete-confirm").classList.add("active");
});

el("btn-cancel-delete").addEventListener("click", () => {
  el("modal-delete-confirm").classList.remove("active");
});

el("btn-confirm-delete").addEventListener("click", async () => {
  const button = el("btn-confirm-delete");
  setButtonLoading(button, true, "Deleting…");
  try {
    await Promise.all(entries.map((entry) => deleteDoc(doc(db, "entries", entry.id))));
    await deleteUser(currentUser);
    el("modal-delete-confirm").classList.remove("active");
  } catch (error) {
    el("modal-delete-confirm").classList.remove("active");
    el("modal-account").classList.add("active");
    el("account-error").textContent =
      error.code === "auth/requires-recent-login"
        ? "Please sign out and sign in again, then retry deleting your account."
        : error.message;
  }
  setButtonLoading(button, false, "Delete Account");
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    el("tab-bar").style.display = "flex";
    showScreen("haircuts");
    listenForEntries();
  } else {
    el("tab-bar").style.display = "none";
    showScreen("auth");
    if (unsubscribeEntries) unsubscribeEntries();
  }
});

// ---------- Haircuts list ----------

function listenForEntries() {
  const entriesQuery = query(
    collection(db, "entries"),
    where("uid", "==", currentUser.uid),
    orderBy("date", "desc")
  );
  unsubscribeEntries = onSnapshot(entriesQuery, (snapshot) => {
    entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderEntries();
  });
}

function renderEntries() {
  const container = el("haircuts-content");
  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">✂️</div>
        <strong>No Haircuts Yet</strong>
        <div>Tap + to log your first haircut.</div>
      </div>`;
    return;
  }
  const rows = entries
    .map((entry) => {
      const date = entry.date.toDate();
      return `
        <div class="entry-row" data-id="${entry.id}">
          <img class="entry-thumb" src="${entry.photoURL}">
          <div class="entry-info">
            <div class="entry-date">${formatDate(date)}</div>
            <div class="entry-relative">${relativeDays(date)}</div>
          </div>
          <span class="entry-chevron">›</span>
        </div>`;
    })
    .join("");
  container.innerHTML = `<div class="card-list">${rows}</div>`;
  container.querySelectorAll(".entry-row").forEach((rowEl) => {
    rowEl.addEventListener("click", () => openDetail(rowEl.dataset.id));
  });
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function relativeDays(date) {
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ---------- Add entry ----------

el("btn-add-entry").addEventListener("click", () => {
  el("add-date").value = new Date().toISOString().slice(0, 10);
  el("add-photo-preview").style.display = "none";
  el("add-photo-label").style.display = "flex";
  el("add-error").textContent = "";
  pendingPhotoFile = null;
  el("modal-add").classList.add("active");
});

el("btn-cancel-add").addEventListener("click", () => {
  el("modal-add").classList.remove("active");
});

el("add-photo-input").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  pendingPhotoFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    el("add-photo-preview").src = reader.result;
    el("add-photo-preview").style.display = "block";
    el("add-photo-label").style.display = "none";
  };
  reader.readAsDataURL(file);
});

el("btn-save-add").addEventListener("click", async () => {
  if (!pendingPhotoFile) {
    el("add-error").textContent = "Please add a photo.";
    return;
  }
  const dateValue = el("add-date").value;
  if (!dateValue) {
    el("add-error").textContent = "Please pick a date.";
    return;
  }
  el("add-error").textContent = "";
  setButtonLoading(el("btn-save-add"), true, "Saving…");
  try {
    const photoURL = await uploadToCloudinary(pendingPhotoFile);
    const entryDate = new Date(dateValue);
    await addDoc(collection(db, "entries"), {
      uid: currentUser.uid,
      date: Timestamp.fromDate(entryDate),
      photoURL,
    });
    el("modal-add").classList.remove("active");
  } catch (error) {
    el("add-error").textContent = error.message;
  }
  setButtonLoading(el("btn-save-add"), false, "Save");
});

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", cloudinaryConfig.uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`,
    { method: "POST", body: formData }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Photo upload failed.");
  }
  return data.secure_url;
}

// ---------- Detail ----------

let currentDetailId = null;

function openDetail(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  currentDetailId = id;
  el("detail-photo").src = entry.photoURL;
  el("detail-date").textContent = formatDate(entry.date.toDate());
  el("modal-detail").classList.add("active");
}

el("btn-close-detail").addEventListener("click", () => {
  el("modal-detail").classList.remove("active");
});

el("btn-delete-detail").addEventListener("click", async () => {
  if (!currentDetailId) return;
  await deleteDoc(doc(db, "entries", currentDetailId));
  el("modal-detail").classList.remove("active");
});

// ---------- Nearby salons ----------

let salonsLoaded = false;

function loadNearbySalons() {
  if (salonsLoaded) return;
  salonsLoaded = true;
  const container = el("salons-content");
  container.innerHTML = `<div class="status-message"><div class="spinner"></div>Finding nearby salons…</div>`;

  if (!navigator.geolocation) {
    container.innerHTML = `<div class="status-message">Location isn't available in this browser.</div>`;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const salons = await fetchNearbySalons(position.coords.latitude, position.coords.longitude);
        renderSalons(salons);
      } catch (error) {
        container.innerHTML = `<div class="status-message">${error.message}</div>`;
      }
    },
    (error) => {
      container.innerHTML = `<div class="status-message">Couldn't get your location: ${error.message}</div>`;
      salonsLoaded = false;
    }
  );
}

async function fetchNearbySalons(latitude, longitude) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googlePlacesApiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.nationalPhoneNumber,places.currentOpeningHours",
    },
    body: JSON.stringify({
      includedTypes: ["hair_salon"],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude, longitude }, radius: 3000.0 },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Failed to load salons.");
  }

  const userPoint = { latitude, longitude };
  return (data.places || [])
    .map((place) => ({
      id: place.id,
      name: place.displayName?.text || "Unknown",
      address: place.formattedAddress || "",
      phone: place.nationalPhoneNumber || null,
      rating: place.rating || null,
      isOpenNow: place.currentOpeningHours?.openNow ?? null,
      distanceMeters: haversineMeters(userPoint, place.location),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function renderSalons(salons) {
  const container = el("salons-content");
  if (salons.length === 0) {
    container.innerHTML = `<div class="status-message">No salons found nearby.</div>`;
    return;
  }
  container.innerHTML = salons
    .map((salon) => {
      const distanceText =
        salon.distanceMeters < 1000
          ? `${Math.round(salon.distanceMeters)} m`
          : `${(salon.distanceMeters / 1000).toFixed(1)} km`;
      const openTag =
        salon.isOpenNow === null ? "" : salon.isOpenNow
          ? `<span class="open">Open now</span>`
          : `<span class="closed">Closed</span>`;
      const ratingTag = salon.rating ? `<span class="rating">★ ${salon.rating.toFixed(1)}</span>` : "";
      const phoneLine = salon.phone ? `<div class="salon-meta"><a href="tel:${salon.phone}">${salon.phone}</a></div>` : "";
      return `
        <div class="salon-card">
          <div class="salon-name">${salon.name}</div>
          <div class="salon-meta">${salon.address} · ${distanceText}</div>
          ${phoneLine}
          <div class="salon-tags">${ratingTag}${openTag}</div>
        </div>`;
    })
    .join("");
}
