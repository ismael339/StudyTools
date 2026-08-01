# Sistema Premium StudyTools - Documentación

## 📋 Descripción General

El sistema premium de StudyTools está completamente configurado y funcional. Esta documentación explica cómo funciona y cómo mantenerlo.

## 🎯 Características Implementadas

### 1. Sistema de Límites Premium
- **Archivo:** `js/premium-limits.js`
- **Función:** Controla el uso de características para usuarios free vs premium
- **Límites configurados:**
  - **Free:** 10 mensajes AI Tutor/día, 500 caracteres máximo
  - **Premium:** 100 mensajes AI Tutor/día, 2000 caracteres máximo

### 2. Sistema de Estado Premium
- **Archivo:** `js/premium-status.js`
- **Función:** Detecta usuarios premium y gestiona la interfaz
- **Características:**
  - Badge "⭐ Pro" en navegación
  - Botón Login/Logout dinámico
  - Bloqueo de características premium
  - Badges de características premium

### 3. Integración en AI Tutor
- **Archivo:** `study-assistant.html`
- **Función:** Aplica límites de mensajes al AI Tutor
- **Características:**
  - Contador de mensajes restantes
  - Límite de caracteres por mensaje
  - Modal de upgrade al alcanzar límite
  - Detección automática de usuarios premium

### 4. Sistema de Autenticación
- **Archivo:** `auth.html`
- **Función:** Sistema de login/registro
- **Características:**
  - Registro con email y contraseña
  - Login con validación
  - Sesión persistente (localStorage)
  - Detección automática de premium

### 5. Sistema de Suscripciones
- **Archivo:** `api/subscription.js`
- **Función:** Gestión de suscripciones PayPal
- **Características:**
  - Guardado de suscripciones
  - Actualización de estado premium
  - Gestión de cancelaciones
  - Integración con PayPal

## 🔧 Configuración Técnica

### Archivos Principales:
```
js/premium-limits.js    - Sistema de límites
js/premium-status.js    - Sistema de estado premium
auth.html               - Sistema de autenticación
api/subscription.js     - API de suscripciones
pro-success.html        - Página de éxito de PayPal
pro.html                - Página de planes y PayPal
index.html              - Página principal con sistema premium
study-assistant.html    - AI Tutor con límites premium
```

### Base de Datos (localStorage):
```javascript
studytools_users         - Usuarios registrados
studytools_current_user  - Usuario actual en sesión
studytools_subscription  - Suscripción activa
studytools_usage         - Uso diario de características
```

## 💰 Planes de Pago Configurados

### Plan Mensual:
- **Precio:** €3.99/mes
- **ID PayPal:** P-44976517YC761723RNI6W5AY
- **Características:** Límites premium aumentados

### Plan Anual:
- **Precio:** €29.99/año
- **ID PayPal:** P-14N28530X9822712DNI6W7NQ
- **Características:** Límites premium + ahorro del 37%

## 🔄 Flujo de Trabajo del Usuario

### 1. Registro:
```
Usuario → auth.html → Registro → localStorage → Account creada
```

### 2. Pago:
```
Usuario → pro.html → Botón PayPal → Pago → pro-success.html → Activación premium
```

### 3. Uso Premium:
```
Login → Verificación de premium → Límites aumentados → Acceso a características premium
```

## 🎨 Interfaz Premium

### Elementos Visuales:
- **Badge "⭐ Pro"** en navegación (solo usuarios premium)
- **Botón Login/Logout** dinámico
- **Contador de uso** en AI Tutor
- **Modal de upgrade** al alcanzar límites
- **Badges de características premium** en herramientas

### Mensajes al Usuario:
- "Free - X messages remaining today"
- "⭐ Pro - Unlimited access"
- Modal de upgrade al alcanzar límites

## 📊 Sistema de Almacenamiento

### Estructura de Datos:

**Usuario:**
```json
{
  "id": "user_1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "password": "hashed_password",
  "isPremium": true,
  "subscriptionId": "P-44976517YC761723RNI6W5AY",
  "premiumSince": "2026-07-30T12:00:00.000Z",
  "createdAt": "2026-07-30T10:00:00.000Z"
}
```

**Uso Diario:**
```json
{
  "2026-07-30": {
    "aiTutorMessages": 5,
    "advancedCalculations": 2
  }
}
```

## 🔒 Seguridad y Limitaciones

### Seguridad Actual:
- Contraseñas almacenadas (sin hash en demo)
- Sesión persistente en localStorage
- Sin backend real (demo purposes)

### Para Producción:
- Implementar hashing de contraseñas
- Usar backend real (Firebase/Supabase)
- Implementar JWT para autenticación
- Usar webhooks de PayPal para actualizaciones

## 🚀 Próximos Pasos para Producción

### 1. Backend Real:
- Configurar Firebase Authentication
- Implementar Firestore para base de datos
- Crear webhooks de PayPal
- Implementar HTTPS obligatorio

### 2. Más Características Premium:
- Exportación de datos (PDF, CSV)
- Herramientas avanzadas de cálculo
- Personalización de interfaces
- Analytics de uso premium

### 3. Marketing y Conversión:
- Añadir testimonios reales
- Implementar sistema de referidos
- Crear landing pages específicas
- Email marketing para retención

## 📈 Métricas para Monitorear

### Métricas Clave:
- Tasa de conversión free → premium
- Churn rate (cancelaciones)
- Lifetime value (LTV)
- Uso de características premium
- Retención de usuarios

### Google Analytics:
- Eventos de pago
- Eventos de upgrade
- Eventos de uso premium
- Flujos de conversión

## 🛠️ Mantenimiento

### Tareas Diarias:
- Monitorear errores de PayPal
- Verificar nuevos usuarios premium
- Revisar límites de uso

### Tareas Semanales:
- Analizar métricas de conversión
- Revisar cancelaciones
- Optimizar experiencia premium

### Tareas Mensuales:
- Actualizar precios si es necesario
- Añadir nuevas características premium
- Analizar feedback de usuarios

## 🐛 Solución de Problemas Comunes

### Usuario no detectado como premium:
1. Verificar localStorage
2. Comprobar datos de suscripción
3. Verificar sistema de PayPal

### Límites no funcionan:
1. Verificar carga de premium-limits.js
2. Comprobar localStorage de uso
3. Revisar lógica de límites

### PayPal no redirige correctamente:
1. Verificar IDs de suscripción
2. Comprobar pro-success.html
3. Revisar configuración de PayPal

## 📞 Soporte y Contacto

Para problemas técnicos con el sistema premium:
1. Revisar esta documentación
2. Verificar console errors
3. Comprobar estado de localStorage
4. Revisar logs de PayPal

## 🎯 Estadísticas Actuales

### Usuarios:
- Free: Ilimitado
- Premium: Basado en pagos PayPal

### Ingresos:
- Mensual: €3.99 × usuarios mensuales
- Anual: €29.99 × usuarios anuales

### Conversions:
- Tasa objetivo: 2-5% de free → premium
- Proyección con 600 visitas/mes: 12-30 usuarios premium/mes

---

**Última actualización:** 31 Julio 2026
**Estado:** Sistema completamente funcional y configurado
**Próxima revisión:** Al regreso de vacaciones (Septiembre 2026)