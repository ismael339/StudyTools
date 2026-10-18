$f = Get-Content 'c:\Users\ismae\OneDrive\Desktop\wep importante\gpa-calculator.html'
$f | Select-String -Pattern 'faq|FAQ|sticky-banner|email-popup|site-footer|toggleFAQ'