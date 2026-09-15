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

    const commitMessage = process.env.COMMIT_MESSAGE || 'New update available';
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>🚀 New StudyTools Update</title><style>body{font-family:'Segoe UI',Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.container{background:#fff;border-radius:20px;padding:40px;box-shadow:0 20px 60px rgba(0,0,0,.2)}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:30px;border-radius:15px;text-align:center;margin-bottom:30px;position:relative;overflow:hidden}.header::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.1) 0%,transparent 70%);animation:shine 3s infinite}@keyframes shine{0%,100%{transform:translate(-30%,-30%)}50%{transform:translate(30%,30%)}}.header h1{margin:0;font-size:28px;font-weight:700;text-shadow:2px 2px 4px rgba(0,0,0,.2)}.emoji{font-size:48px;margin-bottom:10px;display:block}.update-badge{background:#ff6b6b;color:#fff;padding:8px 20px;border-radius:20px;font-size:14px;font-weight:bold;display:inline-block;margin:15px 0;animation:pulse 2s infinite}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}.content{padding:20px 0}.feature-box{background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%);border-radius:15px;padding:25px;margin:20px 0;border-left:5px solid #667eea}.feature-box h3{margin-top:0;color:#667eea;font-size:18px}.cta{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:15px 40px;text-decoration:none;border-radius:25px;display:inline-block;margin:25px 0;font-weight:bold;font-size:16px;box-shadow:0 10px 20px rgba(102,126,234,.3);transition:transform .3s}.cta:hover{transform:translateY(-3px)}.stats{display:flex;justify-content:space-around;margin:30px 0}.stat{text-align:center}.stat-number{font-size:32px;font-weight:bold;color:#667eea}.stat-label{font-size:12px;color:#777;margin-top:5px}.footer{margin-top:40px;padding-top:25px;border-top:2px solid #eee;color:#777;font-size:13px;text-align:center}.social-links{margin-top:15px}.social-links a{color:#667eea;text-decoration:none;margin:0 10px;font-weight:500}.social-links a:hover{text-decoration:underline}</style></head><body><div class="container"><div class="header"><span class="emoji">🚀</span><h1>NEW UPDATE AVAILABLE!</h1><div class="update-badge">JUST ARRIVED</div></div><div class="content"><p style="font-size:18px;color:#555;margin-bottom:25px">Hello student 👋,</p><p style="font-size:16px;line-height:1.8">Great news! We just launched a new update on <strong>StudyTools</strong> that will make your study experience even better.</p><div class="feature-box"><h3>🎁 What's new in this version:</h3><p style="font-size:15px;color:#444;margin:0">${commitMessage}</p></div><div class="stats"><div class="stat"><div class="stat-number">100%</div><div class="stat-label">FREE</div></div><div class="stat"><div class="stat-number">24/7</div><div class="stat-label">AVAILABLE</div></div><div class="stat"><div class="stat-number">⭐</div><div class="stat-label">USEFUL</div></div></div><p style="text-align:center;font-size:16px;margin:25px 0"><a href="https://www.studytools.pro" class="cta">TRY IT NOW! →</a></p><p style="text-align:center;font-size:14px;color:#666">Date: ${date}</p><p style="font-size:15px;color:#555;line-height:1.7">We're constantly working to provide you with the best study tools <strong>completely free</strong>. Your academic success is our priority!</p><p style="font-size:15px;color:#555">Do you like StudyTools? 🎓 <strong>Share it with your classmates and help them study better!</strong></p></div><div class="footer"><p>© 2026 StudyTools.pro - Free study tools for students</p><div class="social-links"><a href="https://www.studytools.pro">Website</a> | <a href="https://www.studytools.pro/privacy.html">Privacy</a></div></div></div></body></html>`;

    let successCount = 0;
    for (const email of emails) {
      try {
        await sendEmail(email, '🚀 NEW UPDATE AVAILABLE!', html);
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
