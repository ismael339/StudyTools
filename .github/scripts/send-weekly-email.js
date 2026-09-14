const https = require('https');

async function getFirebaseEmails() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey = process.env.FIREBASE_API_KEY;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${projectId}/databases/(default)/documents/emails`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const emails = json.documents?.map(doc => {
            const fields = doc.fields;
            return fields?.email?.stringValue;
          }).filter(email => email) || [];
          resolve(emails);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function sendEmail(email, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: 'StudyTools <noreply@studytools.pro>',
      to: email,
      subject: subject,
      html: html
    });

    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    const emails = await getFirebaseEmails();
    console.log(`Found ${emails.length} emails`);

    const weekNumber = new Date().getWeekNumber();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Study Tips Semanales</title><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;border-radius:10px;padding:30px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.header{background:linear-gradient(135deg,#6f7cff,#4fd1c5);color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center}.header h1{margin:0;font-size:24px}.tip-box{background:#f9f9f9;border-left:4px solid #6f7cff;padding:15px;margin:20px 0}.tip-box h3{margin-top:0;color:#6f7cff}.cta{background:linear-gradient(135deg,#6f7cff,#4fd1c5);color:#fff;padding:12px 30px;text-decoration:none;border-radius:5px;display:inline-block;margin:20px 0;font-weight:bold}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#777;font-size:12px;text-align:center}</style></head><body><div class="container"><div class="header"><h1>🎓 Study Tips de la Semana - Semana ${weekNumber}</h1></div><div class="content"><p>Hola estudiante,</p><p>¡Es lunes! Ya sabes lo que significa: tiempo de nuevos tips para estudiar mejor esta semana.</p><div class="tip-box"><h3>💡 Tip del día: La regla de los 5 minutos</h3><p>¿Te cuesta empezar a estudiar? Comprométete a estudiar solo 5 minutos. Casi siempre, una vez que empiezas, seguirás más tiempo. El truco es vencer la resistencia inicial.</p></div><div class="tip-box"><h3>🎯 Tu reto de esta semana</h3><p>Elige una materia donde estás luchando y dedícale 20 minutos cada día esta semana. Pequeños pasos consistentes logran grandes resultados.</p></div><p><strong>Herramientas que te pueden ayudar esta semana:</strong></p><ul><li>🧠 <a href="https://www.studytools.pro/study-assistant.html">AI Tutor</a> - Pregunta dudas difíciles</li><li>📊 <a href="https://www.studytools.pro/gpa-calculator.html">GPA Calculator</a> - Calcula tu promedio</li><li>⏱️ <a href="https://www.studytools.pro/pomodoro-timer.html">Pomodoro Timer</a> - Estudia en bloques enfocados</li></ul><p><a href="https://www.studytools.pro" class="cta">Empezar a estudiar ahora →</a></p><p>¡Tú puedes lograrlo! Estamos aquí para apoyarte en tu camino académico.</p></div><div class="footer"><p>© 2026 StudyTools.pro - Herramientas de estudio gratuitas para estudiantes</p><p><a href="https://www.studytools.pro/privacy.html">Política de privacidad</a> | <a href="https://www.studytools.pro">Sitio web</a></p></div></div></body></html>`;

    let successCount = 0;
    for (const email of emails) {
      try {
        await sendEmail(email, `📚 Tu dosis semanal de study tips - Semana ${weekNumber}`, html);
        successCount++;
        console.log(`✓ Sent to ${email}`);
      } catch (error) {
        console.error(`✗ Failed to send to ${email}:`, error.message);
      }
    }

    console.log(`Successfully sent ${successCount}/${emails.length} emails`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Polyfill for getWeekNumber
Date.prototype.getWeekNumber = function() {
  const d = new Date(Date.UTC(this.getFullYear(), this.getMonth(), this.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
};

main();
