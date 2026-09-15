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
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const month = new Date().toLocaleDateString('en-US', { month: 'long' });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>📚 Weekly Study Tips</title><style>body{font-family:'Segoe UI',Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%)}.container{background:#fff;border-radius:20px;padding:40px;box-shadow:0 20px 60px rgba(0,0,0,.2)}.header{background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:#fff;padding:30px;border-radius:15px;text-align:center;margin-bottom:30px;position:relative;overflow:hidden}.header::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.1) 0%,transparent 70%);animation:shine 3s infinite}@keyframes shine{0%,100%{transform:translate(-30%,-30%)}50%{transform:translate(30%,30%)}}.header h1{margin:0;font-size:26px;font-weight:700;text-shadow:2px 2px 4px rgba(0,0,0,.2)}.emoji{font-size:45px;margin-bottom:10px;display:block}.week-badge{background:#4CAF50;color:#fff;padding:8px 20px;border-radius:20px;font-size:14px;font-weight:bold;display:inline-block;margin:15px 0}.content{padding:20px 0}.intro-text{font-size:18px;color:#555;margin-bottom:25px;text-align:center}.tip-box{background:linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%);border-radius:15px;padding:25px;margin:20px 0;border-left:5px solid #f5576c}.tip-box h3{margin-top:0;color:#f5576c;font-size:18px;margin-bottom:15px}.tip-number{font-size:24px;font-weight:bold;color:#f5576c;margin-right:10px}.tools-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin:25px 0}.tool-card{background:#f8f9fa;border-radius:12px;padding:20px;text-align:center;transition:transform .3s}.tool-card:hover{transform:translateY(-5px)}.tool-emoji{font-size:30px;margin-bottom:10px;display:block}.tool-name{font-weight:bold;color:#333;font-size:14px}.tool-link{color:#f5576c;text-decoration:none;font-size:12px;margin-top:5px;display:block}.cta{background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:#fff;padding:15px 40px;text-decoration:none;border-radius:25px;display:inline-block;margin:25px 0;font-weight:bold;font-size:16px;box-shadow:0 10px 20px rgba(240,147,251,.3);transition:transform .3s}.cta:hover{transform:translateY(-3px)}.motivation{background:linear-gradient(135deg,#a8edea 0%,#fed6e3 100%);border-radius:15px;padding:25px;margin:25px 0;text-align:center}.motivation-text{font-size:16px;color:#444;font-style:italic;margin:0}.footer{margin-top:40px;padding-top:25px;border-top:2px solid #eee;color:#777;font-size:13px;text-align:center}.date-text{color:#999;font-size:12px;margin-top:10px}</style></head><body><div class="container"><div class="header"><span class="emoji">📚</span><h1>YOUR WEEKLY STUDY TIPS!</h1><div class="week-badge">WEEK ${weekNumber} - ${month.toUpperCase()}</div></div><div class="content"><p class="intro-text">Hello student! 👋<br>It's Monday in <strong>${month}</strong>! You know what that means: new opportunities to learn and grow.</p><div class="tip-box"><h3><span class="tip-number">💡</span> TIP #1: The 5-Minute Rule</h3><p style="font-size:15px;color:#444;margin:0">Struggling to start studying? Commit to studying just 5 minutes. Almost always, once you start, you'll continue longer. The trick is overcoming initial resistance.</p></div><div class="tip-box"><h3><span class="tip-number">🎯</span> TIP #2: Your Weekly Challenge</h3><p style="font-size:15px;color:#444;margin:0">Choose a subject where you're struggling and dedicate 20 minutes every day this week. Small consistent steps achieve big results.</p></div><div class="tip-box"><h3><span class="tip-number">⚡</span> TIP #3: Pomodoro Technique</h3><p style="font-size:15px;color:#444;margin:0">Study in 25-minute blocks with 5-minute breaks. Your brain needs breaks to process information effectively.</p></div><p style="text-align:center;font-size:16px;font-weight:bold;color:#333;margin:25px 0">🛠️ TOOLS THAT WILL HELP YOU THIS WEEK:</p><div class="tools-grid"><div class="tool-card"><span class="tool-emoji">🧠</span><div class="tool-name">AI Tutor</div><a href="https://www.studytools.pro/study-assistant.html" class="tool-link">Ask questions →</a></div><div class="tool-card"><span class="tool-emoji">📊</span><div class="tool-name">GPA Calculator</div><a href="https://www.studytools.pro/gpa-calculator.html" class="tool-link">Calculate GPA →</a></div><div class="tool-card"><span class="tool-emoji">⏰</span><div class="tool-name">Pomodoro Timer</div><a href="https://www.studytools.pro/pomodoro-timer.html" class="tool-link">Study better →</a></div></div><div class="motivation"><p class="motivation-text">"Success is not the key to happiness. Happiness is the key to success. If you love what you are doing, you will be successful." - Albert Schweitzer</p></div><p style="text-align:center;font-size:16px;margin:25px 0"><a href="https://www.studytools.pro" class="cta">START STUDYING! →</a></p><p style="text-align:center;font-size:14px;color:#666">You have a full week ahead to achieve your academic goals! 🎓</p></div><div class="footer"><p>© 2026 StudyTools.pro - Free study tools for students</p><p><a href="https://www.studytools.pro/privacy.html" style="color:#f5576c;text-decoration:none">Privacy Policy</a> | <a href="https://www.studytools.pro" style="color:#f5576c;text-decoration:none">Website</a></p><p class="date-text">Date: ${date}</p></div></div></body></html>`;

    let successCount = 0;
    for (const email of emails) {
      try {
        await sendEmail(email, `📚 YOUR WEEKLY STUDY TIPS! - Week ${weekNumber}`, html);
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
