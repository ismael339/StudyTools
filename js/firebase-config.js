// Firebase Configuration for StudyTools
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
  firebase.initializeApp(firebaseConfig);

  // Set auth persistence to LOCAL for auto-login
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => {
      console.log('Firebase auth persistence set to LOCAL');
    })
    .catch((error) => {
      console.error('Error setting auth persistence:', error);
    });
}

// Check if user is logged in
function isUserLoggedIn() {
  return localStorage.getItem('studytools_logged_in') === 'true';
}

function getCurrentUserEmail() {
  return localStorage.getItem('studytools_user_email');
}
