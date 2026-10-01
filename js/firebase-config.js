// Firebase Configuration and Auth State Management for StudyTools
const firebaseConfig = {
  apiKey: "AIzaSyDx4StAzPExYbQU_9yJ04R7HO2JX1_sq6w",
  authDomain: "studytools-b60e9.firebaseapp.com",
  projectId: "studytools-b60e9",
  storageBucket: "studytools-b60e9.firebasestorage.app",
  messagingSenderId: "444074505899",
  appId: "1:444074505899:web:0bc0044a9e1e42d6a3a9ee",
  measurementId: "G-HHLZRTX7WN"
};

// Initialize Firebase with persistence for auto-login
if (typeof firebase !== 'undefined') {
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Set auth persistence to LOCAL for auto-login
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => {
      // Persistence configured
    })
    .catch((error) => {
      console.error('Error setting auth persistence:', error);
    });

  // Keep user profile & plan in sync whenever auth state changes
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      localStorage.setItem('studytools_logged_in', 'true');
      localStorage.setItem('studytools_user_email', user.email || '');

      try {
        const db = firebase.firestore();
        // Profiles are keyed by uid now; older accounts used the email as id.
        // The plan is NOT copied into localStorage any more: that value was the
        // one the interface trusted, so it could be edited to fake Pro. Only the
        // display name is cached here, and the plan comes from /api/entitlement.
        let snap = await db.collection('users').doc(user.uid).get();
        if (!snap.exists && user.email) {
          snap = await db.collection('users').doc(user.email).get();
        }
        const data = snap.exists ? snap.data() : {};
        localStorage.setItem('studytools_current_user', JSON.stringify({
          email: user.email,
          name: data.name || user.displayName || (user.email || '').split('@')[0]
        }));
        try {
          localStorage.removeItem('studytools_user_plan');
          localStorage.removeItem('studytools_subscription');
        } catch (legacyError) { /* ignore */ }
        if (window.PremiumLimits && typeof window.PremiumLimits.refresh === 'function') {
          window.PremiumLimits.refresh(true).catch(() => {});
        }
      } catch (err) {
        console.warn('Could not fetch user Firestore profile:', err);
      }
    } else {
      localStorage.removeItem('studytools_logged_in');
      localStorage.removeItem('studytools_user_email');
      localStorage.removeItem('studytools_current_user');
      localStorage.removeItem('studytools_user_plan');
      localStorage.removeItem('studytools_subscription');
      if (window.PremiumLimits && typeof window.PremiumLimits.refresh === 'function') {
        window.PremiumLimits.refresh(true).catch(() => {});
      }
    }

    if (window.PremiumManager && typeof window.PremiumManager.init === 'function') {
      window.PremiumManager.init();
    }
  });
}

// Check if user is logged in
function isUserLoggedIn() {
  return localStorage.getItem('studytools_logged_in') === 'true';
}

function getCurrentUserEmail() {
  return localStorage.getItem('studytools_user_email');
}

// The plan is server state now. Anything asking for it must ask the server.
function getCurrentUserPlan() {
  if (window.PremiumLimits && window.PremiumLimits.getState) {
    return window.PremiumLimits.getState().plan || 'free';
  }
  return 'free';
}

