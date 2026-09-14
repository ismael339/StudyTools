// Navigation and user menu system for StudyTools

function initNavigation() {
  console.log('initNavigation called');
  const navContainer = document.getElementById('user-nav');

  if (!navContainer) {
    console.error('user-nav element not found');
    return;
  }

  console.log('user-nav element found');

  // Check if Firebase is available
  if (typeof firebase === 'undefined') {
    console.error('Firebase is not available');
    navContainer.innerHTML = `
      <button class="login-btn" onclick="showLoginModal()">
        <span>👤</span> Iniciar sesión
      </button>
    `;
    return;
  }

  console.log('Firebase is available');

  try {
    const auth = firebase.auth();
    console.log('Firebase auth initialized');

    auth.onAuthStateChanged((user) => {
      console.log('Auth state changed, user:', user ? user.email : 'not logged in');

      if (user) {
        // User is logged in - show avatar with dropdown
        navContainer.innerHTML = `
          <div class="user-menu">
            <div class="user-avatar" onclick="toggleUserMenu()">
              <span class="avatar-letter">${user.email[0].toUpperCase()}</span>
            </div>
            <div class="user-dropdown" id="user-dropdown" style="display: none;">
              <div class="dropdown-header">
                <div class="dropdown-avatar">${user.email[0].toUpperCase()}</div>
                <div class="dropdown-info">
                  <div class="dropdown-email">${user.email}</div>
                  <div class="dropdown-plan">Plan Free</div>
                </div>
              </div>
              <div class="dropdown-divider"></div>
              <a href="/profile.html" class="dropdown-item">
                <span>👤</span> Mi perfil
              </a>
              <a href="/pricing.html" class="dropdown-item">
                <span>⭐</span> Mejorar plan
              </a>
              <a href="/privacy.html" class="dropdown-item">
                <span>🔒</span> Privacidad
              </a>
              <div class="dropdown-divider"></div>
              <a href="#" onclick="logout()" class="dropdown-item logout">
                <span>🚪</span> Cerrar sesión
              </a>
            </div>
          </div>
        `;
        console.log('User menu rendered');
      } else {
        // User is not logged in - show login button
        navContainer.innerHTML = `
          <button class="login-btn" onclick="showLoginModal()">
            <span>👤</span> Iniciar sesión
          </button>
        `;
        console.log('Login button rendered');
      }
    });
  } catch (error) {
    console.error('Error initializing Firebase auth:', error);
    navContainer.innerHTML = `
      <button class="login-btn" onclick="showLoginModal()">
        <span>👤</span> Iniciar sesión
      </button>
    `;
  }
}

function toggleUserMenu() {
  const dropdown = document.getElementById('user-dropdown');
  if (dropdown) {
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  }
}

function showLoginModal() {
  // Redirect to login page
  window.location.href = '/login.html';
}

function logout() {
  const auth = firebase.auth();
  auth.signOut().then(() => {
    window.location.href = '/';
  });
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
  const userMenu = document.querySelector('.user-menu');
  const dropdown = document.getElementById('user-dropdown');

  if (userMenu && dropdown && !userMenu.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});

// Initialize navigation when DOM is ready
document.addEventListener('DOMContentLoaded', initNavigation);
