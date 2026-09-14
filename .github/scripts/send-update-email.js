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

    const commitMessage = process.env.COMMIT_MESSAGE || 'Nueva actualización disponible';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actualización StudyTools</title><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4}.container{background:#fff;border-radius:10px;padding:30px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.header{background:linear-gradient(135deg,#6f7cff,#4fd1c5);color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center}.header h1{margin:0;font-size:24px}.content{padding:20px 0}.cta{background:linear-gradient(135deg,#6f7cff,#4fd1c5);color:#fff;padding:12px 30px;text-decoration:none;border-radius:5px;display:inline-block;margin:20px 0;font-weight:bold}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#777;font-size:12px;text-align:center}</style></head><body><div class="container"><div class="header"><h1>🎓 ¡No te pierdas la nueva actualización!</h1></div><div class="content"><p>Hola estudiante,</p><p>Acabamos de publicar una nueva actualización en StudyTools con mejoras que te ayudarán a estudiar mejor.</p><p><strong>Lo nuevo:</strong></p><p>${commitMessage}</p><p><a href="https://www.studytools.pro" class="cta">Ver las novedades →</a></p><p>Estamos constantemente mejorando nuestras herramientas para que tengas la mejor experiencia de estudio gratuita.</p><p>¿Te gusta StudyTools? ¡Compártelo con tus compañeros de clase!</p></div><div class="footer"><p>© 2026 StudyTools.pro - Herramientas de estudio gratuitas para estudiantes</p><p><a href="https://www.studytools.pro/privacy.html">Política de privacidad</a> | <a href="https://www.studytools.pro">Sitio web</a></p></div></div></body></html>`;

    let successCount = 0;
    for (const email of emails) {
      try {
        await sendEmail(email, '🚀 ¡Nueva actualización en StudyTools!', html);
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

main();
