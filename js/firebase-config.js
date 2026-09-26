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
        const doc = await db.collection('users').doc(user.email).get();
        if (doc.exists) {
          const data = doc.data();
          const isPro = data.plan === 'premium';
          localStorage.setItem('studytools_user_plan', data.plan || 'free');
          localStorage.setItem('studytools_current_user', JSON.stringify({
            email: user.email,
            name: data.name || user.displayName || user.email.split('@')[0],
            isPremium: isPro,
            plan: data.plan || 'free',
            subscriptionId: data.subscriptionId || null
          }));
        } else {
          localStorage.setItem('studytools_user_plan', 'free');
          localStorage.setItem('studytools_current_user', JSON.stringify({
            email: user.email,
            name: user.displayName || user.email.split('@')[0],
            isPremium: false,
            plan: 'free'
          }));
        }
      } catch (err) {
        console.warn('Could not fetch user Firestore profile:', err);
      }
    } else {
      localStorage.removeItem('studytools_logged_in');
      localStorage.removeItem('studytools_user_email');
      localStorage.removeItem('studytools_user_plan');
      localStorage.removeItem('studytools_current_user');
      localStorage.removeItem('studytools_subscription');
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

function getCurrentUserPlan() {
  return localStorage.getItem('studytools_user_plan') || 'free';
}

